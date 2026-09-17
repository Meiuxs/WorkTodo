import { ValidationError } from '../domain/errors.js';
import { createTaskEvent } from '../domain/task-event.js';
import { validateTask } from '../domain/task.js';
import { openWorkTodoDatabase } from './database.js';

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

function prepareTag(tag) {
  if (tag === null || typeof tag !== 'object' || Array.isArray(tag)) {
    throw new ValidationError('tag 必须是对象');
  }
  if (typeof tag.id !== 'string' || tag.id.length === 0) {
    throw new ValidationError('tag.id 不能为空');
  }
  if (typeof tag.name !== 'string' || tag.name.trim().length === 0) {
    throw new ValidationError('tag.name 不能为空');
  }
  return clone({ ...tag, name: tag.name.trim() });
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

export class TagRepository {
  #database;

  constructor(database = null) {
    this.#database = database ?? openWorkTodoDatabase();
  }

  async #getDatabase() {
    return this.#database;
  }

  async create(tag) {
    const tagToSave = prepareTag(tag);
    const database = await this.#getDatabase();
    const transaction = database.transaction('tags', 'readwrite');
    transaction.objectStore('tags').add(tagToSave);
    await transactionResult(transaction);
    return clone(tagToSave);
  }

  async get(id) {
    const database = await this.#getDatabase();
    const transaction = database.transaction('tags', 'readonly');
    const tag = await requestResult(transaction.objectStore('tags').get(id));
    await transactionResult(transaction);
    return tag === undefined ? undefined : clone(tag);
  }

  async list() {
    const database = await this.#getDatabase();
    const transaction = database.transaction('tags', 'readonly');
    const tags = await requestResult(transaction.objectStore('tags').getAll());
    await transactionResult(transaction);
    return tags.map(clone);
  }

  async update(tag) {
    const tagToSave = prepareTag(tag);
    const database = await this.#getDatabase();
    const transaction = database.transaction('tags', 'readwrite');
    const tags = transaction.objectStore('tags');
    const current = await requestResult(tags.get(tagToSave.id));
    if (current === undefined) {
      transaction.abort();
      try {
        await transactionResult(transaction);
      } catch {
        // 标签不存在是调用方可恢复的业务结果。
      }
      throw new ValidationError(`标签 ${tagToSave.id} 不存在`);
    }
    tags.put(tagToSave);
    await transactionResult(transaction);
    return clone(tagToSave);
  }

  async deleteAndDetach(id, { updatedAt, createEvent }) {
    const database = await this.#getDatabase();
    const transaction = database.transaction(['tasks', 'tags', 'events'], 'readwrite');
    const tags = transaction.objectStore('tags');
    const tasks = transaction.objectStore('tasks');

    try {
      const tag = await requestResult(tags.get(id));
      if (tag === undefined) {
        throw new ValidationError(`标签 ${id} 不存在`);
      }
      if (typeof createEvent !== 'function') {
        throw new ValidationError('删除标签需要事件创建函数');
      }

      const currentTasks = await requestResult(tasks.index('tagIds').getAll(id));
      const changes = currentTasks.map((current) => {
        const task = prepareTask({
          ...current,
          tagIds: current.tagIds.filter((tagId) => tagId !== id),
          updatedAt,
          revision: current.revision + 1,
        });
        return { task, event: prepareEvent(task.id, createEvent(task)) };
      });

      for (const { task, event } of changes) {
        tasks.put(task);
        transaction.objectStore('events').add(event);
      }
      tags.delete(id);
      await transactionResult(transaction);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // 已完成或已中止的事务无需重复处理。
      }
      throw error;
    }
  }
}
