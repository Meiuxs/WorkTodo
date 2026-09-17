import { ValidationError } from '../domain/errors.js';
import { validateTask } from '../domain/task.js';
import { createTaskEvent } from '../domain/task-event.js';
import { SettingsRepository } from '../data/settings-repository.js';

const SCHEMA_VERSION = 2;
const V1_TOP_LEVEL_FIELDS = ['schemaVersion', 'appVersion', 'exportedAt', 'tasks', 'categories', 'events', 'settings'];
const V2_TOP_LEVEL_FIELDS = [...V1_TOP_LEVEL_FIELDS, 'tags', 'recurringTemplates'];
const TASK_RELATIONSHIP_FIELDS = ['parentId', 'tagIds', 'seriesId', 'occurrenceKey'];
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

function validateTopLevel(backup, schemaVersion) {
  assertPlainObject(backup, 'backup');
  const expectedFields = schemaVersion === 1 ? V1_TOP_LEVEL_FIELDS : V2_TOP_LEVEL_FIELDS;
  const keys = Object.keys(backup).sort();
  const expected = [...expectedFields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new ValidationError(`备份顶层字段必须固定为 ${expectedFields.join(', ')}`);
  }
  if (typeof backup.appVersion !== 'string' || backup.appVersion.length === 0) {
    throw new ValidationError('appVersion 不能为空');
  }
  assertIsoString(backup.exportedAt, 'exportedAt');
  assertArray(backup.tasks, 'tasks');
  assertArray(backup.categories, 'categories');
  assertArray(backup.events, 'events');
  if (schemaVersion === 2) {
    assertArray(backup.tags, 'tags');
    assertArray(backup.recurringTemplates, 'recurringTemplates');
  }
  assertPlainObject(backup.settings, 'settings');
}

function upgradeBackup(backup) {
  if (backup.schemaVersion !== 1) {
    return clone(backup);
  }
  const upgraded = clone(backup);
  upgraded.schemaVersion = SCHEMA_VERSION;
  upgraded.tasks = upgraded.tasks.map((task) => ({
    parentId: null,
    tagIds: [],
    seriesId: null,
    occurrenceKey: null,
    ...task,
  }));
  upgraded.tags = [];
  upgraded.recurringTemplates = [];
  return upgraded;
}

function validateCategories(categories) {
  assertUniqueUuid(categories, 'category');
  for (const category of categories) {
    if (typeof category.name !== 'string' || category.name.trim().length === 0) {
      throw new ValidationError('category.name 不能为空');
    }
    assertIsoString(category.createdAt, 'category.createdAt');
    assertIsoString(category.updatedAt, 'category.updatedAt');
  }
}

function validateTasks(tasks, categoryIds) {
  assertUniqueUuid(tasks, 'task');
  for (const task of tasks) {
    for (const field of TASK_RELATIONSHIP_FIELDS) {
      if (!Object.hasOwn(task, field)) {
        throw new ValidationError(`task.${field} 必须显式提供`);
      }
    }
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

function latestEntity(local, incoming, timeField) {
  const incomingTime = Date.parse(incoming[timeField]);
  const localTime = Date.parse(local[timeField]);
  return incomingTime > localTime ? incoming : local;
}

function conflictsFor(entity, localItems, incomingItems) {
  const incomingById = new Map(incomingItems.map((item) => [item.id, item]));
  return localItems
    .filter((item) => incomingById.has(item.id))
    .map((item) => ({
      entity,
      id: item.id,
      local: item,
      incoming: incomingById.get(item.id),
    }));
}

function allConflicts(current, backup) {
  return [
    ...conflictsFor('tasks', current.tasks, backup.tasks),
    ...conflictsFor('categories', current.categories, backup.categories),
    ...conflictsFor('events', current.events, backup.events),
    ...conflictsFor('tags', current.tags ?? [], backup.tags),
    ...conflictsFor('recurringTemplates', current.recurringTemplates ?? [], backup.recurringTemplates),
  ];
}

function mergeById(localItems, incomingItems, timeField) {
  const items = new Map(localItems.map((item) => [item.id, item]));
  for (const item of incomingItems) {
    const local = items.get(item.id);
    items.set(item.id, local === undefined ? item : latestEntity(local, item, timeField));
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
    assertPlainObject(backup, 'backup');
    if (![1, SCHEMA_VERSION].includes(backup.schemaVersion)) {
      throw new ValidationError('schemaVersion 不受支持');
    }
    validateTopLevel(backup, backup.schemaVersion);
    const upgraded = upgradeBackup(backup);
    const categoryIds = new Set(upgraded.categories.map((category) => category.id));
    validateCategories(upgraded.categories);
    validateTasks(upgraded.tasks, categoryIds);
    const taskIds = new Set(upgraded.tasks.map((task) => task.id));
    validateEvents(upgraded.events, taskIds);
    return clone(upgraded);
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
      tags: snapshot.tags ?? [],
      recurringTemplates: snapshot.recurringTemplates ?? [],
      settings: (await this.#settingsRepository.getSettings()) ?? {},
    };
    await this.#saveMetadata({ lastExportedAt: backup.exportedAt });
    return clone(backup);
  }

  async previewImport(text) {
    const backup = this.validateBackup(text);
    const current = await this.#repository.exportAll();
    const conflicts = allConflicts(current, backup);
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
    const conflicts = allConflicts(current, backup);
    const snapshot = {
      tasks: mergeById(current.tasks, backup.tasks, 'updatedAt'),
      categories: mergeById(current.categories, backup.categories, 'updatedAt'),
      events: mergeById(current.events, backup.events, 'occurredAt'),
      tags: mergeById(current.tags ?? [], backup.tags, 'updatedAt'),
      recurringTemplates: mergeById(
        current.recurringTemplates ?? [],
        backup.recurringTemplates,
        'updatedAt',
      ),
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
      tags: backup.tags,
      recurringTemplates: backup.recurringTemplates,
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
