import { createTaskEvent } from '../domain/task-event.js';
import { ConflictError, DomainError, ValidationError } from '../domain/errors.js';
import { validateTask } from '../domain/task.js';
import { materializeTaskRelationships, openWorkTodoDatabase } from './database.js';
import {
  createSearchIndexRecord,
  normalizeSearchQuery,
  normalizeSearchText,
  querySearchGrams,
} from './search-index.js';

export { ConflictError };

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

function prepareCategory(category) {
  if (category === null || typeof category !== 'object' || Array.isArray(category)) {
    throw new ValidationError('category 必须是对象');
  }
  if (typeof category.id !== 'string' || category.id.length === 0) {
    throw new ValidationError('category.id 不能为空');
  }
  if (typeof category.name !== 'string' || category.name.trim().length === 0) {
    throw new ValidationError('category.name 不能为空');
  }
  return clone({ ...category, name: category.name.trim() });
}

function matchesCriteria(task, criteria = {}) {
  return Object.entries(criteria).every(([field, value]) => task[field] === value);
}

function matchingTasks(tasks, criteria = {}) {
  return tasks
    .map(materializeTaskRelationships)
    .filter((task) => matchesCriteria(task, criteria))
    .map(clone);
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
    const transaction = database.transaction(['tasks', 'events', 'searchIndex'], 'readwrite');
    transaction.objectStore('tasks').add(taskToSave);
    transaction.objectStore('events').add(eventToSave);
    transaction.objectStore('searchIndex').put(createSearchIndexRecord(taskToSave));
    await transactionResult(transaction);
    return clone(taskToSave);
  }

  async findByOccurrenceKey(occurrenceKey) {
    if (occurrenceKey === null || occurrenceKey === undefined) return undefined;
    const database = await this.#getDatabase();
    const transaction = database.transaction('tasks', 'readonly');
    const task = await requestResult(
      transaction.objectStore('tasks').index('occurrenceKey').get(occurrenceKey),
    );
    await transactionResult(transaction);
    return task === undefined ? undefined : clone(materializeTaskRelationships(task));
  }

  async createIfOccurrenceAbsent(task, event) {
    const existing = await this.findByOccurrenceKey(task.occurrenceKey);
    if (existing !== undefined) return { created: false, task: existing };
    try {
      const saved = await this.create(task, event);
      return { created: true, task: saved };
    } catch (error) {
      if (error?.name !== 'ConstraintError') throw error;
      const fallback = await this.findByOccurrenceKey(task.occurrenceKey);
      if (fallback === undefined) throw error;
      return { created: false, task: fallback };
    }
  }

  async get(id) {
    const database = await this.#getDatabase();
    const transaction = database.transaction('tasks', 'readonly');
    const task = await requestResult(transaction.objectStore('tasks').get(id));
    await transactionResult(transaction);
    return task === undefined ? undefined : clone(materializeTaskRelationships(task));
  }

  async update(task, expectedRevision, event) {
    assertRevision(expectedRevision);
    const requestedTask = prepareTask(task);
    const eventToSave = prepareEvent(requestedTask.id, event);
    const database = await this.#getDatabase();
    const transaction = database.transaction(['tasks', 'events', 'searchIndex'], 'readwrite');
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
    transaction.objectStore('searchIndex').put(createSearchIndexRecord(taskToSave));
    await transactionResult(transaction);
    return clone(taskToSave);
  }

  async list(criteria = {}) {
    const database = await this.#getDatabase();
    const transaction = database.transaction('tasks', 'readonly');
    const tasks = await requestResult(transaction.objectStore('tasks').getAll());
    await transactionResult(transaction);
    return tasks
      .map(materializeTaskRelationships)
      .filter((task) => matchesCriteria(task, criteria))
      .map(clone);
  }

  async listTrashed() {
    const database = await this.#getDatabase();
    const transaction = database.transaction('tasks', 'readonly');
    const tasks = await requestResult(
      transaction.objectStore('tasks')
        .index('trashedAt')
        .getAll(IDBKeyRange.bound('', '\uffff')),
    );
    await transactionResult(transaction);
    return matchingTasks(tasks);
  }

  async permanentlyDelete(id, expectedRevision) {
    assertRevision(expectedRevision);
    const database = await this.#getDatabase();
    const transaction = database.transaction(['tasks', 'events', 'searchIndex', 'taskResources'], 'readwrite');
    const tasks = transaction.objectStore('tasks');
    const searchIndex = transaction.objectStore('searchIndex');
    const taskResources = transaction.objectStore('taskResources');
    const current = await requestResult(tasks.get(id));
    if (current === undefined || current.revision !== expectedRevision) {
      transaction.abort();
      try {
        await transactionResult(transaction);
      } catch {
        // 冲突是调用方可恢复的业务结果，不泄露 IndexedDB 的中止错误。
      }
      throw new ConflictError(id);
    }
    if (current.trashedAt === null) {
      transaction.abort();
      try {
        await transactionResult(transaction);
      } catch {
        // 非回收站任务是可恢复的校验结果。
      }
      throw new ValidationError('只能永久删除回收站中的任务');
    }
    const children = await requestResult(tasks.index('parentId').getAll(id));
    if (children.length > 0) {
      transaction.abort();
      try { await transactionResult(transaction); } catch { /* expected abort */ }
      throw new ValidationError('请先删除子任务后再永久删除父任务');
    }
    const events = await requestResult(
      transaction.objectStore('events').index('taskId').getAll(id),
    );
    for (const event of events) transaction.objectStore('events').delete(event.id);
    const relations = await requestResult(taskResources.index('taskId').getAll(id));
    for (const relation of relations) taskResources.delete([relation.taskId, relation.resourceId]);
    searchIndex.delete(id);
    tasks.delete(id);
    await transactionResult(transaction);
    return clone(current);
  }

  async deleteCreated(id, expectedRevision) {
    assertRevision(expectedRevision);
    const database = await this.#getDatabase();
    const transaction = database.transaction(['tasks', 'events', 'searchIndex'], 'readwrite');
    const tasks = transaction.objectStore('tasks');
    const searchIndex = transaction.objectStore('searchIndex');
    const current = await requestResult(tasks.get(id));
    if (current === undefined || current.revision !== expectedRevision) {
      transaction.abort();
      try { await transactionResult(transaction); } catch { /* 统一为业务错误 */ }
      throw new ConflictError(id);
    }
    if (current.lifecycle !== 'todo' || current.trashedAt !== null) {
      transaction.abort();
      try { await transactionResult(transaction); } catch { /* 统一为业务错误 */ }
      throw new ValidationError('只能撤销尚未开始的任务创建');
    }
    const events = await requestResult(transaction.objectStore('events').index('taskId').getAll(id));
    for (const event of events) transaction.objectStore('events').delete(event.id);
    searchIndex.delete(id);
    tasks.delete(id);
    await transactionResult(transaction);
    return clone(current);
  }

  async #listTaskIndex(indexName, range, criteria = {}) {
    const database = await this.#getDatabase();
    const transaction = database.transaction('tasks', 'readonly');
    const tasks = await requestResult(transaction.objectStore('tasks').index(indexName).getAll(range));
    await transactionResult(transaction);
    return matchingTasks(tasks, criteria);
  }

  async listScheduled(fromDate, toDate, criteria = {}) {
    return this.#listTaskIndex(
      'scheduledDate',
      IDBKeyRange.bound(fromDate, toDate),
      criteria,
    );
  }

  async listCompleted(fromIso, toIso, criteria = {}) {
    return this.#listTaskIndex(
      'completedAt',
      IDBKeyRange.bound(fromIso, toIso, false, true),
      criteria,
    );
  }

  async listCreated(fromIso, toIso, criteria = {}) {
    return this.#listTaskIndex(
      'createdAt',
      IDBKeyRange.bound(fromIso, toIso, false, true),
      criteria,
    );
  }

  async listByLifecycle(lifecycle, criteria = {}) {
    return this.#listTaskIndex('lifecycle', IDBKeyRange.only(lifecycle), criteria);
  }

  async listEventsByOccurredAt(fromIso, toIso, types = null) {
    const database = await this.#getDatabase();
    const transaction = database.transaction('events', 'readonly');
    const events = await requestResult(
      transaction.objectStore('events')
        .index('occurredAt')
        .getAll(IDBKeyRange.bound(fromIso, toIso, false, true)),
    );
    await transactionResult(transaction);
    const acceptedTypes = types === null ? null : new Set(types);
    return events
      .filter((event) => acceptedTypes === null || acceptedTypes.has(event.type))
      .map(clone);
  }

  async getMany(ids) {
    if (!Array.isArray(ids)) {
      throw new ValidationError('ids 必须是数组');
    }
    if (ids.length === 0) return [];

    const database = await this.#getDatabase();
    const transaction = database.transaction('tasks', 'readonly');
    const tasks = await Promise.all(
      ids.map((id) => requestResult(transaction.objectStore('tasks').get(id))),
    );
    await transactionResult(transaction);
    return tasks
      .filter((task) => task !== undefined)
      .map(materializeTaskRelationships)
      .map(clone);
  }

  async search(text) {
    const query = normalizeSearchQuery(text);
    const database = await this.#getDatabase();
    const transaction = database.transaction(['tasks', 'searchIndex'], 'readonly');
    const tasks = transaction.objectStore('tasks');

    if (query.length === 0) {
      const records = await requestResult(tasks.getAll());
      await transactionResult(transaction);
      return matchingTasks(records, { trashedAt: null });
    }

    const searchIndex = transaction.objectStore('searchIndex').index('grams');
    let candidateIds = null;
    for (const gram of querySearchGrams(query)) {
      const keys = await requestResult(searchIndex.getAllKeys(IDBKeyRange.only(gram)));
      const gramIds = new Set(keys);
      if (candidateIds === null) {
        candidateIds = gramIds;
      } else {
        candidateIds = new Set([...candidateIds].filter((id) => gramIds.has(id)));
      }
      if (candidateIds.size === 0) break;
    }

    const records = await Promise.all(
      [...(candidateIds ?? [])]
        .sort()
        .map((id) => requestResult(tasks.get(id))),
    );
    await transactionResult(transaction);
    return records
      .filter((task) => (
        task !== undefined
        && task.trashedAt === null
        && normalizeSearchText(task.title, task.description).includes(query)
      ))
      .map(materializeTaskRelationships)
      .map(clone);
  }

  async createCategory(category) {
    const categoryToSave = prepareCategory(category);
    const database = await this.#getDatabase();
    const transaction = database.transaction('categories', 'readwrite');
    transaction.objectStore('categories').add(categoryToSave);
    await transactionResult(transaction);
    return clone(categoryToSave);
  }

  async getCategory(id) {
    const database = await this.#getDatabase();
    const transaction = database.transaction('categories', 'readonly');
    const category = await requestResult(transaction.objectStore('categories').get(id));
    await transactionResult(transaction);
    return category === undefined ? undefined : clone(category);
  }

  async listCategories() {
    const database = await this.#getDatabase();
    const transaction = database.transaction('categories', 'readonly');
    const categories = await requestResult(transaction.objectStore('categories').getAll());
    await transactionResult(transaction);
    return categories.map(clone);
  }

  async updateCategory(category) {
    const categoryToSave = prepareCategory(category);
    const database = await this.#getDatabase();
    const transaction = database.transaction('categories', 'readwrite');
    const categories = transaction.objectStore('categories');
    const current = await requestResult(categories.get(categoryToSave.id));
    if (current === undefined) {
      transaction.abort();
      try { await transactionResult(transaction); } catch { /* 统一为业务错误 */ }
      throw new ValidationError(`列表 ${categoryToSave.id} 不存在`);
    }
    categories.put(categoryToSave);
    await transactionResult(transaction);
    return clone(categoryToSave);
  }

  async deleteCategoryAndMoveTasks(categoryId, destinationCategoryId, { updatedAt, createEvent }) {
    const database = await this.#getDatabase();
    const transaction = database.transaction(
      ['tasks', 'categories', 'events', 'searchIndex'],
      'readwrite',
    );
    const categories = transaction.objectStore('categories');
    const tasks = transaction.objectStore('tasks');
    const searchIndex = transaction.objectStore('searchIndex');
    try {
      const category = await requestResult(categories.get(categoryId));
      const destination = destinationCategoryId === null
        ? null
        : await requestResult(categories.get(destinationCategoryId));
      if (category === undefined || (destinationCategoryId !== null && destination === undefined)) {
        throw new ValidationError('列表不存在');
      }
      if (typeof createEvent !== 'function') {
        throw new ValidationError('列表迁移需要事件创建函数');
      }

      const currentTasks = await requestResult(tasks.index('categoryId').getAll(categoryId));
      const migrations = currentTasks.map((current) => {
        const task = prepareTask({
          ...current,
          categoryId: destinationCategoryId,
          updatedAt,
          revision: current.revision + 1,
        });
        return { task, event: prepareEvent(task.id, createEvent(task)) };
      });
      for (const { task, event } of migrations) {
        tasks.put(task);
        transaction.objectStore('events').add(event);
        searchIndex.put(createSearchIndexRecord(task));
      }
      categories.delete(categoryId);
      await transactionResult(transaction);
      return clone(migrations);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // 已完成或已中止的事务无需重复处理。
      }
      throw error;
    }
  }

  async exportAll() {
    const database = await this.#getDatabase();
    const transaction = database.transaction(
      ['tasks', 'categories', 'events', 'tags', 'recurringTemplates'],
      'readonly',
    );
    const [tasks, categories, events, tags, recurringTemplates] = await Promise.all([
      requestResult(transaction.objectStore('tasks').getAll()),
      requestResult(transaction.objectStore('categories').getAll()),
      requestResult(transaction.objectStore('events').getAll()),
      requestResult(transaction.objectStore('tags').getAll()),
      requestResult(transaction.objectStore('recurringTemplates').getAll()),
    ]);
    await transactionResult(transaction);
    return clone({
      tasks: tasks.map(materializeTaskRelationships),
      categories,
      events,
      tags,
      recurringTemplates,
    });
  }

  async replaceAll(snapshot) {
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new ValidationError('snapshot 必须是对象');
    }
    const tasks = (snapshot.tasks ?? []).map(prepareTask);
    const categories = (snapshot.categories ?? []).map(prepareCategory);
    const events = (snapshot.events ?? []).map((event) => createTaskEvent(event));
    const tags = clone(snapshot.tags ?? []);
    const recurringTemplates = clone(snapshot.recurringTemplates ?? []);
    const taskIds = new Set(tasks.map((task) => task.id));
    if (events.some((event) => !taskIds.has(event.taskId))) {
      throw new ValidationError('event.taskId 必须引用快照中的任务');
    }

    const database = await this.#getDatabase();
    const transaction = database.transaction(
      ['tasks', 'categories', 'events', 'tags', 'recurringTemplates', 'searchIndex'],
      'readwrite',
    );
    const completion = transactionResult(transaction);
    try {
      for (const storeName of [
        'tasks',
        'categories',
        'events',
        'tags',
        'recurringTemplates',
        'searchIndex',
      ]) {
        transaction.objectStore(storeName).clear();
      }
      for (const task of tasks) {
        transaction.objectStore('tasks').put(task);
        transaction.objectStore('searchIndex').put(createSearchIndexRecord(task));
      }
      for (const category of categories) transaction.objectStore('categories').put(category);
      for (const event of events) transaction.objectStore('events').put(event);
      for (const tag of tags) transaction.objectStore('tags').put(tag);
      for (const template of recurringTemplates) {
        transaction.objectStore('recurringTemplates').put(template);
      }
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // 已结束或已中止的事务无需重复中止。
      }
      try {
        await completion;
      } catch {
        // 保留同步写入错误作为对外错误。
      }
      throw error;
    }
    await completion;
  }
}
