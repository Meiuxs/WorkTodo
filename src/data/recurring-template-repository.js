import { createTaskEvent } from '../domain/task-event.js';
import { validateRecurringTemplate } from '../domain/recurring-template.js';
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

export class RecurringTemplateRepository {
  #database;

  constructor(database = null) {
    this.#database = database ?? openWorkTodoDatabase();
  }

  async createWithTask(template, task, event) {
    validateRecurringTemplate(template);
    validateTask(task);
    const eventToSave = createTaskEvent(event);
    if (eventToSave.taskId !== task.id) throw new TypeError('event.taskId 必须与任务一致');
    const database = await this.#database;
    const transaction = database.transaction(
      ['recurringTemplates', 'tasks', 'events'],
      'readwrite',
    );
    transaction.objectStore('recurringTemplates').add(clone(template));
    transaction.objectStore('tasks').add(clone(task));
    transaction.objectStore('events').add(eventToSave);
    await transactionResult(transaction);
    return { template: clone(template), task: clone(task) };
  }

  async get(id) {
    const database = await this.#database;
    const transaction = database.transaction('recurringTemplates', 'readonly');
    const template = await requestResult(transaction.objectStore('recurringTemplates').get(id));
    await transactionResult(transaction);
    return template === undefined ? undefined : clone(template);
  }

  async list() {
    const database = await this.#database;
    const transaction = database.transaction('recurringTemplates', 'readonly');
    const templates = await requestResult(transaction.objectStore('recurringTemplates').getAll());
    await transactionResult(transaction);
    return templates.map(clone);
  }

  async update(template) {
    validateRecurringTemplate(template);
    const database = await this.#database;
    const transaction = database.transaction('recurringTemplates', 'readwrite');
    transaction.objectStore('recurringTemplates').put(clone(template));
    await transactionResult(transaction);
    return clone(template);
  }

  async exportAll() {
    return { templates: await this.list() };
  }
}
