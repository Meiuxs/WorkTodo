import { createTaskEvent } from '../domain/task-event.js';
import { DomainError, ValidationError } from '../domain/errors.js';
import { validateTask } from '../domain/task.js';
import { openWorkTodoDatabase } from './database.js';

export class ConflictError extends DomainError {
  constructor(taskId) {
    super(`任务 ${taskId} 已被其他编辑更新`);
    this.name = 'ConflictError';
    this.taskId = taskId;
  }
}

function clone(value) {
  return structuredClone(value);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已中止'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
  });
}

function assertRevision(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError('expectedRevision 必须是非负整数');
  }
}

function prepareTask(task) {
  const copy = clone(task);
  validateTask(copy);
  return copy;
}

function prepareEvent(taskId, event) {
  const copy = createTaskEvent(event);
  if (copy.taskId !== taskId) {
    throw new ValidationError('event.taskId 必须与任务一致');
  }
  return copy;
}

function matchesCriteria(task, criteria = {}) {
  return Object.entries(criteria).every(([field, value]) => task[field] === value);
}

export class TaskRepository {
  #database;

  constructor(database = null) {
    this.#database = database ?? openWorkTodoDatabase();
  }

  async #getDatabase() {
    return this.#database;
  }

  async create(task, event) {
    const taskToSave = prepareTask(task);
    const eventToSave = prepareEvent(taskToSave.id, event);
    const database = await this.#getDatabase();
    const transaction = database.transaction(['tasks', 'events'], 'readwrite');
    transaction.objectStore('tasks').add(taskToSave);
    transaction.objectStore('events').add(eventToSave);
    await transactionResult(transaction);
    return clone(taskToSave);
  }

  async get(id) {
    const database = await this.#getDatabase();
    const transaction = database.transaction('tasks', 'readonly');
    const task = await requestResult(transaction.objectStore('tasks').get(id));
    await transactionResult(transaction);
    return task === undefined ? undefined : clone(task);
  }

  async update(task, expectedRevision, event) {
    assertRevision(expectedRevision);
    const requestedTask = prepareTask(task);
    const eventToSave = prepareEvent(requestedTask.id, event);
    const database = await this.#getDatabase();
    const transaction = database.transaction(['tasks', 'events'], 'readwrite');
    const tasks = transaction.objectStore('tasks');
    const currentTask = await requestResult(tasks.get(requestedTask.id));

    if (currentTask === undefined || currentTask.revision !== expectedRevision) {
      transaction.abort();
      try {
        await transactionResult(transaction);
      } catch {
        // 冲突是调用方可恢复的业务结果，不泄露 IndexedDB 的中止错误。
      }
      throw new ConflictError(requestedTask.id);
    }

    const taskToSave = { ...requestedTask, revision: expectedRevision + 1 };
    validateTask(taskToSave);
    tasks.put(taskToSave);
    transaction.objectStore('events').add(eventToSave);
    await transactionResult(transaction);
    return clone(taskToSave);
  }

  async list(criteria = {}) {
    const database = await this.#getDatabase();
    const transaction = database.transaction('tasks', 'readonly');
    const tasks = await requestResult(transaction.objectStore('tasks').getAll());
    await transactionResult(transaction);
    return tasks.filter((task) => matchesCriteria(task, criteria)).map(clone);
  }

  async exportAll() {
    const database = await this.#getDatabase();
    const transaction = database.transaction(['tasks', 'categories', 'events'], 'readonly');
    const [tasks, categories, events] = await Promise.all([
      requestResult(transaction.objectStore('tasks').getAll()),
      requestResult(transaction.objectStore('categories').getAll()),
      requestResult(transaction.objectStore('events').getAll()),
    ]);
    await transactionResult(transaction);
    return clone({ tasks, categories, events });
  }

  async replaceAll(snapshot) {
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new ValidationError('snapshot 必须是对象');
    }
    const tasks = (snapshot.tasks ?? []).map(prepareTask);
    const categories = clone(snapshot.categories ?? []);
    const events = (snapshot.events ?? []).map((event) => createTaskEvent(event));
    const taskIds = new Set(tasks.map((task) => task.id));
    if (events.some((event) => !taskIds.has(event.taskId))) {
      throw new ValidationError('event.taskId 必须引用快照中的任务');
    }

    const database = await this.#getDatabase();
    const transaction = database.transaction(['tasks', 'categories', 'events'], 'readwrite');
    for (const storeName of ['tasks', 'categories', 'events']) {
      transaction.objectStore(storeName).clear();
    }
    for (const task of tasks) transaction.objectStore('tasks').put(task);
    for (const category of categories) transaction.objectStore('categories').put(category);
    for (const event of events) transaction.objectStore('events').put(event);
    await transactionResult(transaction);
  }
}
