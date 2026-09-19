import { ValidationError } from '../domain/errors.js';
import { validateTask } from '../domain/task.js';
import { createTaskEvent } from '../domain/task-event.js';
import { SettingsRepository } from '../data/settings-repository.js';

const SCHEMA_VERSION = 2;
const V1_TOP_LEVEL_FIELDS = ['schemaVersion', 'appVersion', 'exportedAt', 'tasks', 'categories', 'events', 'settings'];
const V2_TOP_LEVEL_FIELDS = [...V1_TOP_LEVEL_FIELDS, 'tags', 'recurringTemplates'];
const RESOURCE_TOP_LEVEL_FIELDS = [...V2_TOP_LEVEL_FIELDS, 'resources', 'taskResources', 'resourceCopyWarnings'];
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
  const accepted = schemaVersion === 1 ? [V1_TOP_LEVEL_FIELDS] : [V2_TOP_LEVEL_FIELDS, RESOURCE_TOP_LEVEL_FIELDS];
  if (!accepted.some((fields) => {
    const expected = [...fields].sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
  })) {
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
    if (Object.hasOwn(backup, 'resources')) {
      assertArray(backup.resources, 'resources');
      assertArray(backup.taskResources, 'taskResources');
      if (!Number.isInteger(backup.resourceCopyWarnings) || backup.resourceCopyWarnings < 0) {
        throw new ValidationError('resourceCopyWarnings 必须是非负整数');
      }
    }
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
  upgraded.resources = [];
  upgraded.taskResources = [];
  upgraded.resourceCopyWarnings = 0;
  return upgraded;
}

function normalizeResourceBackup(backup) {
  const upgraded = clone(backup);
  upgraded.resources ??= [];
  upgraded.taskResources ??= [];
  upgraded.resourceCopyWarnings ??= 0;
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

function validateTags(tags) {
  assertUniqueUuid(tags, 'tag');
  const names = new Set();
  const normalizedTags = [];
  for (const tag of tags) {
    if (typeof tag.name !== 'string' || tag.name.trim().length === 0) {
      throw new ValidationError('tag.name 不能为空');
    }
    const normalizedName = tag.name.trim();
    if (names.has(normalizedName)) {
      throw new ValidationError('tag.name 必须唯一');
    }
    names.add(normalizedName);
    assertIsoString(tag.createdAt, 'tag.createdAt');
    assertIsoString(tag.updatedAt, 'tag.updatedAt');
    normalizedTags.push({ ...tag, name: normalizedName });
  }
  return normalizedTags;
}

function validateRecurringTemplates(recurringTemplates) {
  assertUniqueUuid(recurringTemplates, 'recurringTemplate');
}

function validateTasks(tasks, categoryIds, tagIds) {
  assertUniqueUuid(tasks, 'task');
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
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
        throw new ValidationError('task.categoryId 必须引用备份中的列表');
      }
    }
    if (task.tagIds.some((tagId) => !tagIds.has(tagId))) {
      throw new ValidationError('task.tagIds 必须引用备份中的标签');
    }
    if (task.parentId !== null) {
      assertUuid(task.parentId, 'task.parentId');
      const parent = tasksById.get(task.parentId);
      if (parent === undefined) {
        throw new ValidationError('task.parentId 必须引用备份中的任务');
      }
      if (parent.id === task.id) {
        throw new ValidationError('task.parentId 不能引用任务自身');
      }
      if (parent.parentId !== null) {
        throw new ValidationError('父任务自身不能是子任务');
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

function validateResources(resources, taskResources, taskIds) {
  assertUniqueUuid(resources, 'resource');
  const resourceIds = new Set(resources.map((resource) => resource.id));
  for (const resource of resources) {
    if (!['url', 'file', 'snippet'].includes(resource.type)) throw new ValidationError('resource.type 无效');
    if (typeof resource.title !== 'string' || resource.title.trim().length === 0) throw new ValidationError('resource.title 不能为空');
    assertIsoString(resource.createdAt, 'resource.createdAt');
    assertIsoString(resource.updatedAt, 'resource.updatedAt');
    if (!Number.isInteger(resource.revision) || resource.revision < 0) throw new ValidationError('resource.revision 无效');
    if (resource.type === 'url' && (typeof resource.url !== 'string' || !/^https?:\/\//i.test(resource.url))) {
      throw new ValidationError('resource.url 只支持 http 或 https');
    }
    if (resource.type === 'snippet' && (typeof resource.content !== 'string' || resource.content.length === 0)) {
      throw new ValidationError('resource.content 不能为空');
    }
    if (resource.type === 'file' && resource.storageMode === 'copy' && resource.copyIncluded !== false) {
      throw new ValidationError('JSON 备份中的文件副本必须标记为未包含');
    }
  }
  const relationKeys = new Set();
  for (const relation of taskResources) {
    const key = `${relation.taskId}:${relation.resourceId}`;
    if (relationKeys.has(key)) throw new ValidationError('taskResources 不能重复');
    relationKeys.add(key);
    if (!taskIds.has(relation.taskId)) throw new ValidationError('taskResources.taskId 必须引用备份中的任务');
    if (!resourceIds.has(relation.resourceId)) throw new ValidationError('taskResources.resourceId 必须引用备份中的资料');
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
    ...conflictsFor('resources', current.resources ?? [], backup.resources ?? []),
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

function mergeRelations(localItems, incomingItems) {
  const relations = new Map(localItems.map((item) => [`${item.taskId}:${item.resourceId}`, item]));
  for (const item of incomingItems) relations.set(`${item.taskId}:${item.resourceId}`, item);
  return [...relations.values()];
}

function importResult(snapshot, conflicts) {
  return {
    taskCount: snapshot.tasks.length,
    categoryCount: snapshot.categories.length,
    eventCount: snapshot.events.length,
    resourceCount: snapshot.resources?.length ?? 0,
    taskResourceCount: snapshot.taskResources?.length ?? 0,
    omittedFileCopies: snapshot.resourceCopyWarnings ?? 0,
    conflicts: conflicts.map((conflict) => clone(conflict)),
  };
}

export class BackupService {
  #repository;
  #resourceRepository;
  #settingsRepository;
  #now;
  #appVersion;

  constructor(repository, {
    resourceRepository = null,
    settingsRepository = new SettingsRepository(),
    now = defaultNow,
    appVersion = '0.1.0',
  } = {}) {
    this.#repository = repository;
    this.#resourceRepository = resourceRepository;
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
    const upgraded = normalizeResourceBackup(upgradeBackup(backup));
    validateCategories(upgraded.categories);
    const categoryIds = new Set(upgraded.categories.map((category) => category.id));
    upgraded.tags = validateTags(upgraded.tags);
    const tagIds = new Set(upgraded.tags.map((tag) => tag.id));
    validateRecurringTemplates(upgraded.recurringTemplates);
    validateTasks(upgraded.tasks, categoryIds, tagIds);
    const taskIds = new Set(upgraded.tasks.map((task) => task.id));
    validateEvents(upgraded.events, taskIds);
    validateResources(upgraded.resources, upgraded.taskResources, taskIds);
    return clone(upgraded);
  }

  serializeBackup(snapshot) {
    return JSON.stringify(snapshot, null, 2);
  }

  async createBackup() {
    const snapshot = await this.#repository.exportAll();
    const resourceSnapshot = this.#resourceRepository?.exportAll
      ? await this.#resourceRepository.exportAll()
      : { resources: [], taskResources: [] };
    const resources = resourceSnapshot.resources.map((resource) => ({
      ...resource,
      blob: null,
      copyIncluded: resource.storageMode === 'copy' ? false : null,
    }));
    const backup = {
      schemaVersion: SCHEMA_VERSION,
      appVersion: this.#appVersion,
      exportedAt: this.#now(),
      tasks: snapshot.tasks,
      categories: snapshot.categories,
      events: snapshot.events,
      tags: snapshot.tags ?? [],
      recurringTemplates: snapshot.recurringTemplates ?? [],
      resources,
      taskResources: resourceSnapshot.taskResources ?? [],
      resourceCopyWarnings: resources.filter((resource) => resource.storageMode === 'copy').length,
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
    const currentResources = this.#resourceRepository?.exportAll
      ? await this.#resourceRepository.exportAll()
      : { resources: [], taskResources: [] };
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
    const resourceSnapshot = {
      resources: mergeById(currentResources.resources, backup.resources, 'updatedAt'),
      taskResources: mergeRelations(currentResources.taskResources, backup.taskResources),
    };
    await this.#repository.replaceAll(snapshot);
    if (this.#resourceRepository?.replaceAll) await this.#resourceRepository.replaceAll(resourceSnapshot);
    await this.#saveMetadata({ lastImportedAt: this.#now() });
    return importResult(snapshot, conflicts);
  }

  async #replaceImport(backup) {
    const recovery = await this.#repository.exportAll();
    const resourceRecovery = this.#resourceRepository?.exportAll
      ? await this.#resourceRepository.exportAll()
      : null;
    const previousSettings = await this.#settingsRepository.getSettings();
    const previousMetadata = await this.#settingsRepository.getMetadata();
    const snapshot = {
      tasks: backup.tasks,
      categories: backup.categories,
      events: backup.events,
      tags: backup.tags,
      recurringTemplates: backup.recurringTemplates,
    };
    const resourceSnapshot = { resources: backup.resources, taskResources: backup.taskResources };
    try {
      await this.#repository.replaceAll(snapshot);
      if (this.#resourceRepository?.replaceAll) await this.#resourceRepository.replaceAll(resourceSnapshot);
      await this.#settingsRepository.saveSettings(backup.settings);
      await this.#saveMetadata({ lastImportedAt: this.#now() });
    } catch (error) {
      await this.#repository.replaceAll(recovery);
      if (resourceRecovery !== null && this.#resourceRepository?.replaceAll) {
        await this.#resourceRepository.replaceAll(resourceRecovery);
      }
      await this.#settingsRepository.saveSettings(previousSettings);
      await this.#settingsRepository.saveMetadata(previousMetadata);
      throw error;
    }
    return importResult(snapshot, []);
  }
}
