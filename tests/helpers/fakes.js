import { createTaskEvent } from '../../src/domain/task-event.js';
import { ValidationError } from '../../src/domain/errors.js';
import { validateTask } from '../../src/domain/task.js';
import { ConflictError } from '../../src/data/task-repository.js';
import { materializeTaskRelationships } from '../../src/data/database.js';
import {
  normalizeSearchQuery,
  normalizeSearchText,
} from '../../src/data/search-index.js';

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

function matchesCriteria(task, criteria = {}) {
  return Object.entries(criteria).every(([field, value]) => task[field] === value);
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareById(left, right) {
  return compareText(left.id, right.id);
}

function compareByIndex(key) {
  return (left, right) => compareText(left[key], right[key]) || compareById(left, right);
}

function taskResults(tasks, criteria = {}, compare = compareById) {
  return tasks
    .map(materializeTaskRelationships)
    .filter((task) => matchesCriteria(task, criteria))
    .sort(compare)
    .map(clone);
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

export class InMemoryTaskRepository {
  #tasks;
  #categories;
  #events;
  #tags;
  #recurringTemplates;
  #nextCategoryMigrationFailure = null;

  constructor(tasks = [], categories = [], events = [], tags = [], recurringTemplates = []) {
    this.#tasks = new Map(tasks.map((task) => [task.id, prepareTask(task)]));
    this.#categories = clone(categories);
    this.#events = events.map((event) => createTaskEvent(event));
    this.#tags = clone(tags);
    this.#recurringTemplates = clone(recurringTemplates);
  }

  #addEvent(event) {
    if (this.#events.some((item) => item.id === event.id)) {
      throw new Error(`事件 ${event.id} 已存在`);
    }
    this.#events.push(event);
  }

  async create(task, event) {
    const taskToSave = prepareTask(task);
    const eventToSave = prepareEvent(taskToSave.id, event);
    if (this.#tasks.has(taskToSave.id)) throw new Error(`任务 ${taskToSave.id} 已存在`);
    this.#tasks.set(taskToSave.id, taskToSave);
    this.#addEvent(eventToSave);
    return clone(taskToSave);
  }

  async get(id) {
    const task = this.#tasks.get(id);
    return task === undefined ? undefined : clone(materializeTaskRelationships(task));
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
    this.#addEvent(eventToSave);
    return clone(taskToSave);
  }

  async list(criteria = {}) {
    return taskResults([...this.#tasks.values()], criteria);
  }

  async listTrashed() {
    return taskResults(
      [...this.#tasks.values()].filter((task) => task.trashedAt !== null),
      {},
      compareByIndex('trashedAt'),
    );
  }

  async permanentlyDelete(id, expectedRevision) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new ValidationError('expectedRevision 必须是非负整数');
    }
    const current = this.#tasks.get(id);
    if (current === undefined || current.revision !== expectedRevision) {
      throw new ConflictError(id);
    }
    if (current.trashedAt === null) {
      throw new ValidationError('只能永久删除回收站中的任务');
    }

    const snapshot = {
      tasks: new Map([...this.#tasks].map(([taskId, task]) => [taskId, clone(task)])),
      events: clone(this.#events),
    };
    try {
      this.#tasks.delete(id);
      this.#events = this.#events.filter((event) => event.taskId !== id);
      return clone(materializeTaskRelationships(current));
    } catch (error) {
      this.#tasks = snapshot.tasks;
      this.#events = snapshot.events;
      throw error;
    }
  }

  async listScheduled(fromDate, toDate, criteria = {}) {
    return taskResults(
      [...this.#tasks.values()].filter((task) => (
        task.scheduledDate !== null
        && task.scheduledDate >= fromDate
        && task.scheduledDate <= toDate
      )),
      criteria,
      compareByIndex('scheduledDate'),
    );
  }

  async listCompleted(fromIso, toIso, criteria = {}) {
    return taskResults(
      [...this.#tasks.values()].filter((task) => (
        task.completedAt !== null
        && task.completedAt >= fromIso
        && task.completedAt < toIso
      )),
      criteria,
      compareByIndex('completedAt'),
    );
  }

  async listCreated(fromIso, toIso, criteria = {}) {
    return taskResults(
      [...this.#tasks.values()].filter((task) => (
        task.createdAt !== null
        && task.createdAt >= fromIso
        && task.createdAt < toIso
      )),
      criteria,
      compareByIndex('createdAt'),
    );
  }

  async listByLifecycle(lifecycle, criteria = {}) {
    return taskResults(
      [...this.#tasks.values()].filter((task) => task.lifecycle === lifecycle),
      criteria,
      compareByIndex('lifecycle'),
    );
  }

  async listEventsByOccurredAt(fromIso, toIso, types = null) {
    const acceptedTypes = types === null ? null : new Set(types);
    return this.#events
      .filter((event) => (
        event.occurredAt >= fromIso
        && event.occurredAt < toIso
        && (acceptedTypes === null || acceptedTypes.has(event.type))
      ))
      .sort((left, right) => (
        compareText(left.occurredAt, right.occurredAt)
        || compareText(left.id, right.id)
      ))
      .map(clone);
  }

  async getMany(ids) {
    if (!Array.isArray(ids)) throw new ValidationError('ids 必须是数组');
    return ids
      .map((id) => this.#tasks.get(id))
      .filter((task) => task !== undefined)
      .map(materializeTaskRelationships)
      .map(clone);
  }

  async search(text) {
    const query = normalizeSearchQuery(text);
    return taskResults(
      [...this.#tasks.values()].filter((task) => (
        task.trashedAt === null
        && (query.length === 0 || normalizeSearchText(task.title, task.description).includes(query))
      )),
    );
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

  failNextCategoryMigration(error, afterFirstWrite = null) {
    this.#nextCategoryMigrationFailure = { error, afterFirstWrite };
  }

  async deleteCategoryAndMoveTasks(categoryId, destinationCategoryId, { updatedAt, createEvent }) {
    const categoryIndex = this.#categories.findIndex((item) => item.id === categoryId);
    if (categoryIndex === -1 || (destinationCategoryId !== null && !this.#categories.some((item) => item.id === destinationCategoryId))) {
      throw new ValidationError('分类不存在');
    }
    if (typeof createEvent !== 'function') throw new ValidationError('分类迁移需要事件创建函数');
    const snapshot = {
      tasks: new Map([...this.#tasks].map(([id, task]) => [id, clone(task)])),
      categories: clone(this.#categories),
      events: clone(this.#events),
    };
    try {
      const saved = [...this.#tasks.values()]
        .filter((task) => task.categoryId === categoryId)
        .map((current) => {
          const task = prepareTask({
            ...current,
            categoryId: destinationCategoryId,
            updatedAt,
            revision: current.revision + 1,
          });
          return { task, event: prepareEvent(task.id, createEvent(task)) };
        });
      for (const item of saved) {
        this.#tasks.set(item.task.id, item.task);
        this.#addEvent(item.event);
        if (this.#nextCategoryMigrationFailure !== null) {
          const { error, afterFirstWrite } = this.#nextCategoryMigrationFailure;
          this.#nextCategoryMigrationFailure = null;
          afterFirstWrite?.(clone({ tasks: [...this.#tasks.values()], categories: this.#categories, events: this.#events }));
          throw error;
        }
      }
      this.#categories.splice(categoryIndex, 1);
      return clone(saved);
    } catch (error) {
      this.#tasks = snapshot.tasks;
      this.#categories = snapshot.categories;
      this.#events = snapshot.events;
      throw error;
    }
  }

  async exportAll() {
    return clone({
      tasks: [...this.#tasks.values()],
      categories: this.#categories,
      events: this.#events,
      tags: this.#tags,
      recurringTemplates: this.#recurringTemplates,
    });
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
    this.#tags = clone(snapshot.tags ?? []);
    this.#recurringTemplates = clone(snapshot.recurringTemplates ?? []);
  }
}

export class InMemoryTagRepository {
  #tags;
  #tasks;
  #events;
  #nextDeleteAndDetachFailure = null;

  constructor(tags = [], tasks = [], events = []) {
    this.#tags = new Map(tags.map((tag) => [tag.id, prepareTag(tag)]));
    this.#tasks = new Map(tasks.map((task) => [task.id, prepareTask(task)]));
    this.#events = events.map((event) => createTaskEvent(event));
  }

  #assertUniqueName(tag, excludedId = null) {
    if ([...this.#tags.values()].some((current) => current.id !== excludedId && current.name === tag.name)) {
      throw new Error('标签名称已存在');
    }
  }

  #addEvent(event) {
    if (this.#events.some((item) => item.id === event.id)) {
      throw new Error(`事件 ${event.id} 已存在`);
    }
    this.#events.push(event);
  }

  async seedTask(task) {
    const taskToSave = prepareTask(task);
    if (this.#tasks.has(taskToSave.id)) throw new Error(`任务 ${taskToSave.id} 已存在`);
    this.#tasks.set(taskToSave.id, taskToSave);
    return clone(taskToSave);
  }

  async getTask(id) {
    const task = this.#tasks.get(id);
    return task === undefined ? undefined : clone(task);
  }

  async create(tag) {
    const tagToSave = prepareTag(tag);
    if (this.#tags.has(tagToSave.id)) throw new Error(`标签 ${tagToSave.id} 已存在`);
    this.#assertUniqueName(tagToSave);
    this.#tags.set(tagToSave.id, tagToSave);
    return clone(tagToSave);
  }

  async get(id) {
    const tag = this.#tags.get(id);
    return tag === undefined ? undefined : clone(tag);
  }

  async list() {
    return clone([...this.#tags.values()]);
  }

  async update(tag) {
    const tagToSave = prepareTag(tag);
    if (!this.#tags.has(tagToSave.id)) throw new ValidationError(`标签 ${tagToSave.id} 不存在`);
    this.#assertUniqueName(tagToSave, tagToSave.id);
    this.#tags.set(tagToSave.id, tagToSave);
    return clone(tagToSave);
  }

  failNextDeleteAndDetach(error, afterFirstWrite = null) {
    this.#nextDeleteAndDetachFailure = { error, afterFirstWrite };
  }

  async deleteAndDetach(id, { updatedAt, createEvent }) {
    if (!this.#tags.has(id)) throw new ValidationError(`标签 ${id} 不存在`);
    if (typeof createEvent !== 'function') {
      throw new ValidationError('删除标签需要事件创建函数');
    }
    const snapshot = {
      tags: new Map([...this.#tags].map(([tagId, tag]) => [tagId, clone(tag)])),
      tasks: new Map([...this.#tasks].map(([taskId, task]) => [taskId, clone(task)])),
      events: clone(this.#events),
    };

    try {
      const affected = [...this.#tasks.values()]
        .filter((task) => task.tagIds.includes(id))
        .map((current) => {
          const task = prepareTask({
            ...current,
            tagIds: current.tagIds.filter((tagId) => tagId !== id),
            updatedAt,
            revision: current.revision + 1,
          });
          return { task, event: prepareEvent(task.id, createEvent(task)) };
        });

      for (const item of affected) {
        this.#tasks.set(item.task.id, item.task);
        this.#addEvent(item.event);
        if (this.#nextDeleteAndDetachFailure !== null) {
          const { error, afterFirstWrite } = this.#nextDeleteAndDetachFailure;
          this.#nextDeleteAndDetachFailure = null;
          afterFirstWrite?.(clone({
            tags: [...this.#tags.values()],
            tasks: [...this.#tasks.values()],
            events: this.#events,
          }));
          throw error;
        }
      }
      this.#tags.delete(id);
    } catch (error) {
      this.#tags = snapshot.tags;
      this.#tasks = snapshot.tasks;
      this.#events = snapshot.events;
      throw error;
    }
  }

  async listEvents(taskId) {
    return clone(this.#events.filter((event) => event.taskId === taskId));
  }

  async exportAll() {
    return clone({
      tags: [...this.#tags.values()],
      tasks: [...this.#tasks.values()],
      events: this.#events,
    });
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
