import { createTaskEvent } from '../../src/domain/task-event.js';
import { ValidationError } from '../../src/domain/errors.js';
import { validateTask } from '../../src/domain/task.js';
import { ConflictError } from '../../src/data/task-repository.js';

function clone(value) {
  return structuredClone(value);
}

function prepareTask(task) {
  const copy = clone(task);
  validateTask(copy);
  return copy;
}

function prepareEvent(taskId, event) {
  const copy = createTaskEvent(event);
  if (copy.taskId !== taskId) throw new ValidationError('event.taskId 必须与任务一致');
  return copy;
}

export class InMemoryTaskRepository {
  #tasks;
  #categories;
  #events;

  constructor(tasks = [], categories = [], events = []) {
    this.#tasks = new Map(tasks.map((task) => [task.id, prepareTask(task)]));
    this.#categories = clone(categories);
    this.#events = events.map((event) => createTaskEvent(event));
  }

  async create(task, event) {
    const taskToSave = prepareTask(task);
    const eventToSave = prepareEvent(taskToSave.id, event);
    if (this.#tasks.has(taskToSave.id)) throw new Error(`任务 ${taskToSave.id} 已存在`);
    this.#tasks.set(taskToSave.id, taskToSave);
    this.#events.push(eventToSave);
    return clone(taskToSave);
  }

  async get(id) {
    const task = this.#tasks.get(id);
    return task === undefined ? undefined : clone(task);
  }

  async update(task, expectedRevision, event) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new ValidationError('expectedRevision 必须是非负整数');
    }
    const requestedTask = prepareTask(task);
    const eventToSave = prepareEvent(requestedTask.id, event);
    const currentTask = this.#tasks.get(requestedTask.id);
    if (currentTask === undefined || currentTask.revision !== expectedRevision) {
      throw new ConflictError(requestedTask.id);
    }
    const taskToSave = { ...requestedTask, revision: expectedRevision + 1 };
    validateTask(taskToSave);
    this.#tasks.set(taskToSave.id, taskToSave);
    this.#events.push(eventToSave);
    return clone(taskToSave);
  }

  async list(criteria = {}) {
    return [...this.#tasks.values()]
      .filter((task) => Object.entries(criteria).every(([field, value]) => task[field] === value))
      .map(clone);
  }

  async createCategory(category) {
    const categoryToSave = clone(category);
    if (this.#categories.some((item) => item.id === categoryToSave.id)) throw new Error(`分类 ${categoryToSave.id} 已存在`);
    this.#categories.push(categoryToSave);
    return clone(categoryToSave);
  }

  async getCategory(id) {
    const category = this.#categories.find((item) => item.id === id);
    return category === undefined ? undefined : clone(category);
  }

  async listCategories() {
    return clone(this.#categories);
  }

  async updateCategory(category) {
    const index = this.#categories.findIndex((item) => item.id === category.id);
    if (index === -1) throw new ValidationError(`分类 ${category.id} 不存在`);
    this.#categories[index] = clone(category);
    return clone(this.#categories[index]);
  }

  async deleteCategoryAndMoveTasks(categoryId, destinationCategoryId, updates) {
    const categoryIndex = this.#categories.findIndex((item) => item.id === categoryId);
    if (categoryIndex === -1 || (destinationCategoryId !== null && !this.#categories.some((item) => item.id === destinationCategoryId))) {
      throw new ValidationError('分类不存在');
    }
    const prepared = updates.map(({ task, expectedRevision, event }) => ({
      task: prepareTask(task), expectedRevision, event: prepareEvent(task.id, event),
    }));
    for (const update of prepared) {
      const current = this.#tasks.get(update.task.id);
      if (current === undefined || current.revision !== update.expectedRevision) throw new ConflictError(update.task.id);
    }
    const saved = prepared.map(({ task, expectedRevision, event }) => {
      const updated = { ...task, revision: expectedRevision + 1 };
      validateTask(updated);
      return { task: updated, event };
    });
    for (const item of saved) {
      this.#tasks.set(item.task.id, item.task);
      this.#events.push(item.event);
    }
    this.#categories.splice(categoryIndex, 1);
    return clone(saved);
  }

  async exportAll() {
    return clone({ tasks: [...this.#tasks.values()], categories: this.#categories, events: this.#events });
  }

  async replaceAll(snapshot) {
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new ValidationError('snapshot 必须是对象');
    }
    const tasks = (snapshot.tasks ?? []).map(prepareTask);
    const events = (snapshot.events ?? []).map((event) => createTaskEvent(event));
    const taskIds = new Set(tasks.map((task) => task.id));
    if (events.some((event) => !taskIds.has(event.taskId))) {
      throw new ValidationError('event.taskId 必须引用快照中的任务');
    }
    this.#tasks = new Map(tasks.map((task) => [task.id, task]));
    this.#categories = clone(snapshot.categories ?? []);
    this.#events = events;
  }
}

export class InMemoryStorageArea {
  #values = new Map();

  async get(key) {
    const keys = Array.isArray(key) ? key : [key];
    return Object.fromEntries(
      keys.filter((item) => this.#values.has(item)).map((item) => [item, clone(this.#values.get(item))]),
    );
  }

  async set(values) {
    for (const [key, value] of Object.entries(values)) {
      this.#values.set(key, clone(value));
    }
  }

  snapshot() {
    return Object.fromEntries([...this.#values].map(([key, value]) => [key, clone(value)]));
  }
}
