import { ValidationError } from '../domain/errors.js';
import { validateTask } from '../domain/task.js';
import { createTaskEvent } from '../domain/task-event.js';
import { SettingsRepository } from '../data/settings-repository.js';

const SCHEMA_VERSION = 1;
const TOP_LEVEL_FIELDS = ['schemaVersion', 'appVersion', 'exportedAt', 'tasks', 'categories', 'events', 'settings'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clone(value) {
  return structuredClone(value);
}

function defaultNow() {
  return new Date().toISOString();
}

function assertPlainObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${fieldName} 必须是对象`);
  }
}

function assertArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} 必须是数组`);
  }
}

function assertIsoString(value, fieldName) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${fieldName} 必须是 ISO 时间字符串`);
  }
}

function assertUuid(value, fieldName) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError(`${fieldName} 必须是 UUID`);
  }
}

function assertUniqueUuid(items, fieldName) {
  const seen = new Set();
  for (const item of items) {
    assertPlainObject(item, fieldName);
    assertUuid(item.id, `${fieldName}.id`);
    if (seen.has(item.id)) {
      throw new ValidationError(`${fieldName}.id 必须唯一`);
    }
    seen.add(item.id);
  }
}

function validateTopLevel(backup) {
  assertPlainObject(backup, 'backup');
  const keys = Object.keys(backup).sort();
  const expected = [...TOP_LEVEL_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new ValidationError(`备份顶层字段必须固定为 ${TOP_LEVEL_FIELDS.join(', ')}`);
  }
  if (backup.schemaVersion !== SCHEMA_VERSION) {
    throw new ValidationError('schemaVersion 不受支持');
  }
  if (typeof backup.appVersion !== 'string' || backup.appVersion.length === 0) {
    throw new ValidationError('appVersion 不能为空');
  }
  assertIsoString(backup.exportedAt, 'exportedAt');
  assertArray(backup.tasks, 'tasks');
  assertArray(backup.categories, 'categories');
  assertArray(backup.events, 'events');
  assertPlainObject(backup.settings, 'settings');
}

function validateCategories(categories) {
  assertUniqueUuid(categories, 'category');
  for (const category of categories) {
    if (typeof category.name !== 'string' || category.name.trim().length === 0) {
      throw new ValidationError('category.name 不能为空');
    }
  }
}

function validateTasks(tasks, categoryIds) {
  assertUniqueUuid(tasks, 'task');
  for (const task of tasks) {
    validateTask(task);
    assertUuid(task.id, 'task.id');
    assertIsoString(task.createdAt, 'task.createdAt');
    assertIsoString(task.updatedAt, 'task.updatedAt');
    if (task.categoryId !== null) {
      assertUuid(task.categoryId, 'task.categoryId');
      if (!categoryIds.has(task.categoryId)) {
        throw new ValidationError('task.categoryId 必须引用备份中的分类');
      }
    }
  }
}

function validateEvents(events, taskIds) {
  assertUniqueUuid(events, 'event');
  for (const event of events) {
    const copy = createTaskEvent(event);
    assertUuid(copy.id, 'event.id');
    assertUuid(copy.taskId, 'event.taskId');
    assertIsoString(copy.occurredAt, 'event.occurredAt');
    if (!taskIds.has(copy.taskId)) {
      throw new ValidationError('event.taskId 必须引用备份中的任务');
    }
  }
}

function parseBackup(text) {
  if (typeof text !== 'string') {
    throw new ValidationError('备份内容必须是字符串');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('备份内容不是合法 JSON');
  }
}

function latestTask(local, incoming) {
  const incomingTime = Date.parse(incoming.updatedAt);
  const localTime = Date.parse(local.updatedAt);
  return incomingTime > localTime ? incoming : local;
}

function mergeById(localItems, incomingItems) {
  const items = new Map(localItems.map((item) => [item.id, item]));
  for (const item of incomingItems) {
    if (!items.has(item.id)) items.set(item.id, item);
  }
  return [...items.values()];
}

function importResult(snapshot, conflicts) {
  return {
    taskCount: snapshot.tasks.length,
    categoryCount: snapshot.categories.length,
    eventCount: snapshot.events.length,
    conflicts: conflicts.map((conflict) => clone(conflict)),
  };
}

export class BackupService {
  #repository;
  #settingsRepository;
  #now;
  #appVersion;

  constructor(repository, {
    settingsRepository = new SettingsRepository(),
    now = defaultNow,
    appVersion = '0.1.0',
  } = {}) {
    this.#repository = repository;
    this.#settingsRepository = settingsRepository;
    this.#now = now;
    this.#appVersion = appVersion;
  }

  async #saveMetadata(changes) {
    const current = await this.#settingsRepository.getMetadata();
    await this.#settingsRepository.saveMetadata({ ...(current ?? {}), ...changes });
  }

  validateBackup(text) {
    const backup = parseBackup(text);
    validateTopLevel(backup);
    const categoryIds = new Set(backup.categories.map((category) => category.id));
    validateCategories(backup.categories);
    validateTasks(backup.tasks, categoryIds);
    const taskIds = new Set(backup.tasks.map((task) => task.id));
    validateEvents(backup.events, taskIds);
    return clone(backup);
  }

  serializeBackup(snapshot) {
    return JSON.stringify(snapshot, null, 2);
  }

  async createBackup() {
    const snapshot = await this.#repository.exportAll();
    const backup = {
      schemaVersion: SCHEMA_VERSION,
      appVersion: this.#appVersion,
      exportedAt: this.#now(),
      tasks: snapshot.tasks,
      categories: snapshot.categories,
      events: snapshot.events,
      settings: (await this.#settingsRepository.getSettings()) ?? {},
    };
    await this.#saveMetadata({ lastExportedAt: backup.exportedAt });
    return clone(backup);
  }

  async previewImport(text) {
    const backup = this.validateBackup(text);
    const current = await this.#repository.exportAll();
    const currentTaskIds = new Set(current.tasks.map((task) => task.id));
    const conflicts = backup.tasks
      .filter((task) => currentTaskIds.has(task.id))
      .map((task) => ({ id: task.id, local: current.tasks.find((item) => item.id === task.id), incoming: task }));
    return importResult(backup, conflicts);
  }

  async importBackup(text, mode) {
    if (!['merge', 'replace'].includes(mode)) {
      throw new ValidationError('导入模式必须是 merge 或 replace');
    }
    const backup = this.validateBackup(text);
    if (mode === 'merge') {
      return this.#mergeImport(backup);
    }
    return this.#replaceImport(backup);
  }

  async #mergeImport(backup) {
    const current = await this.#repository.exportAll();
    const incomingTasks = new Map(backup.tasks.map((task) => [task.id, task]));
    const conflicts = current.tasks
      .filter((task) => incomingTasks.has(task.id))
      .map((task) => ({ id: task.id, local: task, incoming: incomingTasks.get(task.id) }));
    const mergedTasks = new Map(current.tasks.map((task) => [task.id, task]));
    for (const task of backup.tasks) {
      const local = mergedTasks.get(task.id);
      mergedTasks.set(task.id, local === undefined ? task : latestTask(local, task));
    }
    const snapshot = {
      tasks: [...mergedTasks.values()],
      categories: mergeById(current.categories, backup.categories),
      events: mergeById(current.events, backup.events),
    };
    await this.#repository.replaceAll(snapshot);
    await this.#saveMetadata({ lastImportedAt: this.#now() });
    return importResult(snapshot, conflicts);
  }

  async #replaceImport(backup) {
    const recovery = await this.#repository.exportAll();
    const previousSettings = await this.#settingsRepository.getSettings();
    const previousMetadata = await this.#settingsRepository.getMetadata();
    const snapshot = {
      tasks: backup.tasks,
      categories: backup.categories,
      events: backup.events,
    };
    try {
      await this.#repository.replaceAll(snapshot);
      await this.#settingsRepository.saveSettings(backup.settings);
      await this.#saveMetadata({ lastImportedAt: this.#now() });
    } catch (error) {
      await this.#repository.replaceAll(recovery);
      await this.#settingsRepository.saveSettings(previousSettings);
      await this.#settingsRepository.saveMetadata(previousMetadata);
      throw error;
    }
    return importResult(snapshot, []);
  }
}
