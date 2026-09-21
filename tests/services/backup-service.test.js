import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/domain/errors.js';
import { BackupService } from '../../src/services/backup-service.js';
import { InMemoryStorageArea, InMemoryTaskRepository } from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';
const LATER = '2026-09-17T09:30:00.000Z';
const SAME_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_EVENT_ID = '55555555-5555-4555-8555-555555555555';
const TAG_ID = '66666666-6666-4666-8666-666666666666';
const TEMPLATE_ID = '77777777-7777-4777-8777-777777777777';
const CHILD_ID = '88888888-8888-4888-8888-888888888888';
const GRANDCHILD_ID = '99999999-9999-4999-8999-999999999999';

const BASE_TASK = {
  id: SAME_ID,
  title: '本机较新版本',
  priority: 'none',
  categoryId: CATEGORY_ID,
  parentId: null,
  tagIds: [],
  seriesId: null,
  occurrenceKey: null,
  scheduledDate: '2026-09-17',
  firstScheduledDate: '2026-09-17',
  startTime: null,
  dueTime: null,
  lifecycle: 'todo',
  revision: 0,
  createdAt: NOW,
  updatedAt: LATER,
  completedAt: null,
  cancelledAt: null,
  trashedAt: null,
};
const OLD_LOCAL_TASK = { ...BASE_TASK, title: '本机旧版本', updatedAt: NOW };
const OTHER_TASK = {
  ...BASE_TASK,
  id: OTHER_ID,
  title: '导入任务',
  categoryId: null,
  updatedAt: LATER,
};
const CATEGORY = { id: CATEGORY_ID, name: '项目', createdAt: NOW, updatedAt: NOW };
const EVENT = { id: EVENT_ID, taskId: SAME_ID, type: 'CREATE', occurredAt: NOW, detail: null };
const OTHER_EVENT = { id: OTHER_EVENT_ID, taskId: OTHER_ID, type: 'CREATE', occurredAt: NOW, detail: null };
const TAG = { id: TAG_ID, name: '客户', createdAt: NOW, updatedAt: NOW };
const TEMPLATE = { id: TEMPLATE_ID, title: '周报', active: true, updatedAt: NOW };

function legacyTask(overrides = {}) {
  const task = { ...OTHER_TASK, ...overrides };
  delete task.parentId;
  delete task.tagIds;
  delete task.seriesId;
  delete task.occurrenceKey;
  return task;
}

function backupFile(overrides = {}) {
  return {
    schemaVersion: 2,
    appVersion: '0.1.0',
    exportedAt: NOW,
    tasks: [OTHER_TASK],
    categories: [],
    events: [OTHER_EVENT],
    tags: [],
    recurringTemplates: [],
    settings: { firstDayOfWeek: 1 },
    ...overrides,
  };
}

function installStorage(storage = new InMemoryStorageArea()) {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = { storage: { local: storage } };
  return () => {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  };
}

function createBackupService({
  tasks = [BASE_TASK],
  categories = [CATEGORY],
  events = [EVENT],
  tags = [],
  recurringTemplates = [],
  storage,
} = {}) {
  const restoreChrome = installStorage(storage);
  const repo = new InMemoryTaskRepository(tasks, categories, events, tags, recurringTemplates);
  const backup = new BackupService(repo, { now: () => NOW, appVersion: '0.1.0' });
  return { backup, repo, restoreChrome, storage };
}

test('非法 JSON 的预览失败且不修改仓库', async () => {
  const { backup, repo, restoreChrome } = createBackupService();
  try {
    await assert.rejects(() => backup.previewImport('{bad json'), ValidationError);
    assert.equal((await repo.exportAll()).tasks.length, 1);
    assert.equal((await repo.get(SAME_ID)).title, '本机较新版本');
  } finally {
    restoreChrome();
  }
});

test('合并保留 updatedAt 较新的同 UUID 任务并报告冲突', async () => {
  const incoming = backupFile({
    tasks: [{ ...BASE_TASK, title: '导入旧版本', updatedAt: NOW }],
    categories: [CATEGORY],
    events: [EVENT],
  });
  const { backup, repo, restoreChrome } = createBackupService();
  try {
    const result = await backup.importBackup(JSON.stringify(incoming), 'merge');
    assert.deepEqual(result.conflicts.map(({ entity, id }) => ({ entity, id })), [
      { entity: 'tasks', id: SAME_ID },
      { entity: 'categories', id: CATEGORY_ID },
      { entity: 'events', id: EVENT_ID },
    ]);
    assert.equal((await repo.get(SAME_ID)).title, '本机较新版本');
  } finally {
    restoreChrome();
  }
});

test('导出包含 schema v2、V1.1 集合、资料集合并记录 metadata', async () => {
  const storage = new InMemoryStorageArea();
  const { backup, restoreChrome } = createBackupService({
    tags: [TAG],
    recurringTemplates: [TEMPLATE],
    storage,
  });
  try {
    const file = await backup.createBackup();
    assert.equal(file.schemaVersion, 2);
    assert.equal(file.appVersion, '0.1.0');
    assert.match(file.exportedAt, /T/);
    assert.deepEqual(Object.keys(file), [
      'schemaVersion',
      'appVersion',
      'exportedAt',
      'tasks',
      'categories',
      'events',
      'tags',
      'recurringTemplates',
      'resources',
      'taskResources',
      'resourceCopyWarnings',
      'settings',
    ]);
    assert.deepEqual(file.tags, [TAG]);
    assert.deepEqual(file.recurringTemplates, [TEMPLATE]);
    assert.equal(storage.snapshot().metadata.lastExportedAt, NOW);
  } finally {
    restoreChrome();
  }
});

test('严格校验顶层字段、schema 版本、UUID 唯一性和任务必需字段', async () => {
  const { backup, restoreChrome } = createBackupService();
  try {
    assert.throws(() => backup.validateBackup(JSON.stringify({ ...backupFile(), extra: true })), ValidationError);
    assert.throws(() => backup.validateBackup(JSON.stringify(backupFile({
      schemaVersion: 1,
      tags: [],
      recurringTemplates: [],
    }))), ValidationError);
    const missingTags = backupFile();
    delete missingTags.tags;
    assert.throws(() => backup.validateBackup(JSON.stringify(missingTags)), ValidationError);
    assert.throws(() => backup.validateBackup(JSON.stringify(backupFile({ schemaVersion: 3 }))), ValidationError);
    assert.throws(() => backup.validateBackup(JSON.stringify(backupFile({
      tasks: [OTHER_TASK, { ...OTHER_TASK, title: '重复 UUID' }],
    }))), ValidationError);
    assert.throws(() => backup.validateBackup(JSON.stringify(backupFile({
      tasks: [{ ...OTHER_TASK, title: '' }],
    }))), ValidationError);
    for (const field of ['parentId', 'tagIds', 'seriesId', 'occurrenceKey']) {
      const task = { ...OTHER_TASK };
      delete task[field];
      assert.throws(
        () => backup.validateBackup(JSON.stringify(backupFile({ tasks: [task] }))),
        ValidationError,
      );
    }
  } finally {
    restoreChrome();
  }
});

test('v2 备份拒绝孤儿、自引用和多级父子链，合法单层子任务通过', async () => {
  const { backup, restoreChrome } = createBackupService();
  try {
    const parent = { ...BASE_TASK, parentId: null };
    const child = { ...OTHER_TASK, parentId: SAME_ID };
    const valid = backup.validateBackup(JSON.stringify(backupFile({
      tasks: [parent, child],
      categories: [CATEGORY],
      events: [EVENT, OTHER_EVENT],
    })));
    assert.equal(valid.tasks.find((task) => task.id === OTHER_ID).parentId, SAME_ID);

    const invalidTasks = [
      [{ ...OTHER_TASK, parentId: SAME_ID }],
      [{ ...OTHER_TASK, parentId: OTHER_ID }],
      [
        { ...BASE_TASK, parentId: null },
        { ...OTHER_TASK, id: CHILD_ID, parentId: SAME_ID },
        { ...OTHER_TASK, id: GRANDCHILD_ID, parentId: CHILD_ID },
      ],
    ];
    for (const tasks of invalidTasks) {
      assert.throws(
        () => backup.validateBackup(JSON.stringify(backupFile({ tasks, events: [] }))),
        ValidationError,
      );
    }
  } finally {
    restoreChrome();
  }
});

test('v1 备份导入时补齐 V1.1 字段并保留原任务、分类、事件和设置', async () => {
  const legacy = JSON.stringify({
    schemaVersion: 1,
    appVersion: '0.1.0',
    exportedAt: NOW,
    tasks: [legacyTask()],
    categories: [CATEGORY],
    events: [OTHER_EVENT],
    settings: { firstDayOfWeek: 1 },
  });
  const { backup, repo, restoreChrome } = createBackupService();
  try {
    const upgraded = await backup.validateBackup(legacy);
    const preview = await backup.previewImport(legacy);

    assert.equal(upgraded.schemaVersion, 2);
    assert.deepEqual(upgraded.tags, []);
    assert.deepEqual(upgraded.recurringTemplates, []);
    assert.deepEqual(upgraded.tasks[0].tagIds, []);
    assert.equal(upgraded.tasks[0].parentId, null);
    assert.equal(upgraded.tasks[0].seriesId, null);
    assert.equal(upgraded.tasks[0].occurrenceKey, null);
    assert.equal(upgraded.tasks[0].title, OTHER_TASK.title);
    assert.deepEqual(upgraded.categories, [CATEGORY]);
    assert.deepEqual(upgraded.events, [OTHER_EVENT]);
    assert.deepEqual(upgraded.settings, { firstDayOfWeek: 1 });
    assert.equal(preview.taskCount, 1);
    assert.equal((await repo.get(SAME_ID)).title, BASE_TASK.title);
  } finally {
    restoreChrome();
  }
});

test('v2 备份在接触仓库前拒绝非法标签、模板和标签引用', async () => {
  const { backup, repo, restoreChrome } = createBackupService();
  try {
    const before = await repo.exportAll();
    let exportAllCalls = 0;
    const originalExportAll = repo.exportAll.bind(repo);
    repo.exportAll = async () => {
      exportAllCalls += 1;
      return originalExportAll();
    };
    const invalidBackups = [
      backupFile({ tags: [{}] }),
      backupFile({ tags: [{ ...TAG, name: '   ' }] }),
      backupFile({ tags: [{ ...TAG, createdAt: '不是时间' }] }),
      backupFile({ tags: [{ ...TAG, updatedAt: 123 }] }),
      backupFile({ tags: [TAG, { ...TAG, name: '重复 ID' }] }),
      backupFile({ tags: [TAG, { ...TAG, id: OTHER_ID }] }),
      backupFile({ recurringTemplates: [{}] }),
      backupFile({ recurringTemplates: [TEMPLATE, { ...TEMPLATE, title: '重复 ID' }] }),
      backupFile({ tasks: [{ ...OTHER_TASK, tagIds: [TAG_ID] }] }),
      backupFile({ tasks: [{ ...OTHER_TASK, categoryId: CATEGORY_ID }] }),
      backupFile({ tasks: [], events: [OTHER_EVENT] }),
      backupFile({ tasks: [{ ...OTHER_TASK, parentId: SAME_ID }], events: [] }),
      backupFile({ tasks: [{ ...OTHER_TASK, parentId: OTHER_ID }], events: [] }),
      backupFile({
        tasks: [
          { ...BASE_TASK, parentId: null },
          { ...OTHER_TASK, id: CHILD_ID, parentId: SAME_ID },
          { ...OTHER_TASK, id: GRANDCHILD_ID, parentId: CHILD_ID },
        ],
        events: [],
      }),
    ];

    for (const invalid of invalidBackups) {
      const text = JSON.stringify(invalid);
      assert.throws(() => backup.validateBackup(text), ValidationError);
      await assert.rejects(() => backup.previewImport(text), ValidationError);
      await assert.rejects(() => backup.importBackup(text, 'merge'), ValidationError);
      await assert.rejects(() => backup.importBackup(text, 'replace'), ValidationError);
      assert.deepEqual(await originalExportAll(), before);
    }
    assert.equal(exportAllCalls, 0);
  } finally {
    restoreChrome();
  }
});

test('标签名称在导入校验和写入边界统一 trim，并拒绝 trim 后重名', async () => {
  const paddedTag = { ...TAG, name: ' 客户 ' };
  const normalized = backupFile({
    tasks: [{ ...OTHER_TASK, tagIds: [TAG_ID] }],
    tags: [paddedTag],
  });
  const duplicate = backupFile({
    tags: [paddedTag, { ...TAG, id: OTHER_ID, name: '客户' }],
  });
  const { backup, restoreChrome } = createBackupService();
  try {
    const validated = backup.validateBackup(JSON.stringify(normalized));
    assert.equal(validated.tags[0].name, '客户');
    assert.throws(() => backup.validateBackup(JSON.stringify(duplicate)), ValidationError);
    await assert.rejects(() => backup.previewImport(JSON.stringify(duplicate)), ValidationError);

    for (const mode of ['merge', 'replace']) {
      const { backup: writer, repo, restoreChrome: restoreWriter } = createBackupService();
      try {
        await writer.importBackup(JSON.stringify(normalized), mode);
        assert.equal((await repo.exportAll()).tags[0].name, '客户');
      } finally {
        restoreWriter();
      }
    }
  } finally {
    restoreChrome();
  }
});

test('v1 备份 merge 保留本机标签和模板，replace 将其替换为空数组', async () => {
  const legacy = JSON.stringify({
    schemaVersion: 1,
    appVersion: '0.1.0',
    exportedAt: NOW,
    tasks: [legacyTask()],
    categories: [],
    events: [OTHER_EVENT],
    settings: { firstDayOfWeek: 1 },
  });
  const { backup, repo, restoreChrome } = createBackupService({
    tags: [TAG],
    recurringTemplates: [TEMPLATE],
  });
  try {
    await backup.importBackup(legacy, 'merge');
    let snapshot = await repo.exportAll();
    assert.deepEqual(snapshot.tags, [TAG]);
    assert.deepEqual(snapshot.recurringTemplates, [TEMPLATE]);

    await backup.importBackup(legacy, 'replace');
    snapshot = await repo.exportAll();
    assert.deepEqual(snapshot.tags, []);
    assert.deepEqual(snapshot.recurringTemplates, []);
  } finally {
    restoreChrome();
  }
});

test('预览只读返回数量和冲突但不修改旧数据', async () => {
  const incoming = backupFile({
    tasks: [{ ...BASE_TASK, title: '导入较新版本', updatedAt: '2026-09-17T10:30:00.000Z' }, OTHER_TASK],
    categories: [CATEGORY],
    events: [EVENT, OTHER_EVENT],
  });
  const { backup, repo, restoreChrome } = createBackupService();
  try {
    const before = await repo.exportAll();
    const preview = await backup.previewImport(JSON.stringify(incoming));
    assert.deepEqual({
      taskCount: preview.taskCount,
      categoryCount: preview.categoryCount,
      eventCount: preview.eventCount,
      conflicts: preview.conflicts.map(({ entity, id }) => ({ entity, id })),
    }, {
      taskCount: 2,
      categoryCount: 1,
      eventCount: 2,
      conflicts: [
        { entity: 'tasks', id: SAME_ID },
        { entity: 'categories', id: CATEGORY_ID },
        { entity: 'events', id: EVENT_ID },
      ],
    });
    assert.deepEqual(await repo.exportAll(), before);
  } finally {
    restoreChrome();
  }
});

test('预览和 merge 报告任务分类事件冲突并按时间选择较新实体', async () => {
  const incomingCategory = { ...CATEGORY, name: '导入较新分类', updatedAt: LATER };
  const incomingEvent = {
    ...EVENT,
    type: 'EDIT',
    occurredAt: LATER,
    detail: { source: 'import' },
  };
  const incoming = backupFile({
    tasks: [{ ...OLD_LOCAL_TASK, title: '导入较新任务', updatedAt: LATER }],
    categories: [incomingCategory],
    events: [incomingEvent],
  });
  const storage = new InMemoryStorageArea();
  const { backup, repo, restoreChrome } = createBackupService({
    tasks: [OLD_LOCAL_TASK],
    categories: [CATEGORY],
    events: [EVENT],
    storage,
  });
  try {
    const preview = await backup.previewImport(JSON.stringify(incoming));
    const merged = await backup.importBackup(JSON.stringify(incoming), 'merge');
    const expectedConflicts = [
      { entity: 'tasks', id: SAME_ID },
      { entity: 'categories', id: CATEGORY_ID },
      { entity: 'events', id: EVENT_ID },
    ];
    assert.deepEqual(preview.conflicts.map(({ entity, id }) => ({ entity, id })), expectedConflicts);
    assert.deepEqual(merged.conflicts.map(({ entity, id }) => ({ entity, id })), expectedConflicts);

    const snapshot = await repo.exportAll();
    assert.equal((await repo.get(SAME_ID)).title, '导入较新任务');
    assert.equal(snapshot.categories.find((category) => category.id === CATEGORY_ID).name, '导入较新分类');
    assert.equal(snapshot.events.find((event) => event.id === EVENT_ID).type, 'EDIT');
    assert.deepEqual(snapshot.events.find((event) => event.id === EVENT_ID).detail, { source: 'import' });
  } finally {
    restoreChrome();
  }
});

test('merge 对分类和事件同时间冲突保留本机实体', async () => {
  const incoming = backupFile({
    tasks: [{ ...OLD_LOCAL_TASK, title: '导入同时间任务' }],
    categories: [{ ...CATEGORY, name: '导入同时间分类' }],
    events: [{ ...EVENT, type: 'EDIT', detail: { source: 'import' } }],
  });
  const { backup, repo, restoreChrome } = createBackupService({
    tasks: [OLD_LOCAL_TASK],
    categories: [CATEGORY],
    events: [EVENT],
  });
  try {
    await backup.importBackup(JSON.stringify(incoming), 'merge');
    const snapshot = await repo.exportAll();
    assert.equal(snapshot.categories.find((category) => category.id === CATEGORY_ID).name, '项目');
    assert.equal(snapshot.events.find((event) => event.id === EVENT_ID).type, 'CREATE');
  } finally {
    restoreChrome();
  }
});

test('merge 和 replace 传递标签与重复模板快照', async () => {
  const incomingTag = { ...TAG, name: '重点客户', updatedAt: LATER };
  const incomingTemplate = { ...TEMPLATE, active: false, updatedAt: LATER };
  const incoming = backupFile({
    tags: [incomingTag],
    recurringTemplates: [incomingTemplate],
  });
  const { backup, repo, restoreChrome } = createBackupService({
    tasks: [],
    categories: [],
    events: [],
    tags: [TAG],
    recurringTemplates: [TEMPLATE],
  });
  try {
    await backup.importBackup(JSON.stringify(incoming), 'merge');
    let snapshot = await repo.exportAll();
    assert.deepEqual(snapshot.tags, [incomingTag]);
    assert.deepEqual(snapshot.recurringTemplates, [incomingTemplate]);

    await backup.importBackup(JSON.stringify(backupFile({
      tags: [TAG],
      recurringTemplates: [TEMPLATE],
    })), 'replace');
    snapshot = await repo.exportAll();
    assert.deepEqual(snapshot.tags, [TAG]);
    assert.deepEqual(snapshot.recurringTemplates, [TEMPLATE]);
  } finally {
    restoreChrome();
  }
});

test('分类必须携带合法 createdAt 和 updatedAt 时间', async () => {
  const { backup, restoreChrome } = createBackupService();
  try {
    assert.throws(() => backup.validateBackup(JSON.stringify(backupFile({
      categories: [{ ...CATEGORY, createdAt: 123 }],
    }))), ValidationError);
    assert.throws(() => backup.validateBackup(JSON.stringify(backupFile({
      categories: [{ ...CATEGORY, updatedAt: '不是时间' }],
    }))), ValidationError);
  } finally {
    restoreChrome();
  }
});

test('merge 导入较新的同 UUID 任务，时间相同保留本机，并写入 metadata', async () => {
  const incoming = backupFile({
    tasks: [
      { ...OLD_LOCAL_TASK, title: '导入较新版本', updatedAt: LATER },
      OTHER_TASK,
    ],
    categories: [CATEGORY],
    events: [EVENT, OTHER_EVENT],
  });
  const storage = new InMemoryStorageArea();
  const { backup, repo, restoreChrome } = createBackupService({ tasks: [OLD_LOCAL_TASK], storage });
  try {
    const result = await backup.importBackup(JSON.stringify(incoming), 'merge');
    assert.deepEqual(result.conflicts.map(({ entity, id }) => ({ entity, id })), [
      { entity: 'tasks', id: SAME_ID },
      { entity: 'categories', id: CATEGORY_ID },
      { entity: 'events', id: EVENT_ID },
    ]);
    assert.equal((await repo.get(SAME_ID)).title, '导入较新版本');
    assert.equal((await repo.get(OTHER_ID)).title, '导入任务');
    assert.equal(storage.snapshot().metadata.lastImportedAt, NOW);

    await backup.importBackup(JSON.stringify(backupFile({
      tasks: [{ ...OLD_LOCAL_TASK, title: '同时间导入版本' }],
      categories: [CATEGORY],
      events: [EVENT],
    })), 'merge');
    assert.equal((await repo.get(SAME_ID)).title, '导入较新版本');
  } finally {
    restoreChrome();
  }
});

test('replace 原子覆盖任务、分类、事件、设置和 metadata', async () => {
  const storage = new InMemoryStorageArea();
  const { backup, repo, restoreChrome } = createBackupService({ storage });
  try {
    const result = await backup.importBackup(JSON.stringify(backupFile()), 'replace');
    assert.equal(result.taskCount, 1);
    assert.equal(await repo.get(SAME_ID), undefined);
    assert.equal((await repo.get(OTHER_ID)).title, '导入任务');
    assert.deepEqual(await repo.listCategories(), []);
    assert.deepEqual((await repo.exportAll()).events, [OTHER_EVENT]);
    assert.deepEqual(storage.snapshot().settings, { firstDayOfWeek: 1 });
    assert.equal(storage.snapshot().metadata.lastImportedAt, NOW);
  } finally {
    restoreChrome();
  }
});

test('replace 失败恢复旧数据且不写 metadata', async () => {
  class FailingReplaceRepository extends InMemoryTaskRepository {
    async replaceAll() {
      throw new Error('事务失败');
    }
  }

  const storage = new InMemoryStorageArea();
  const restoreChrome = installStorage(storage);
  const repo = new FailingReplaceRepository([BASE_TASK], [CATEGORY], [EVENT]);
  const backup = new BackupService(repo, { now: () => NOW, appVersion: '0.1.0' });
  try {
    const before = await repo.exportAll();
    await assert.rejects(() => backup.importBackup(JSON.stringify(backupFile()), 'replace'), /事务失败/);
    assert.deepEqual(await repo.exportAll(), before);
    assert.equal(storage.snapshot().metadata, undefined);
  } finally {
    restoreChrome();
  }
});

test('replace 写入设置失败时恢复已覆盖的任务数据和旧设置', async () => {
  class FailingSettingsStorage extends InMemoryStorageArea {
    failNextSettingsWrite = false;

    async set(values) {
      if (this.failNextSettingsWrite && Object.hasOwn(values, 'settings')) {
        this.failNextSettingsWrite = false;
        await super.set(values);
        throw new Error('设置写入失败');
      }
      await super.set(values);
    }
  }

  const storage = new FailingSettingsStorage();
  const restoreChrome = installStorage(storage);
  const repo = new InMemoryTaskRepository([BASE_TASK], [CATEGORY], [EVENT]);
  const backup = new BackupService(repo, { now: () => NOW, appVersion: '0.1.0' });
  try {
    await storage.set({ settings: { firstDayOfWeek: 2 } });
    const before = await repo.exportAll();
    storage.failNextSettingsWrite = true;

    await assert.rejects(() => backup.importBackup(JSON.stringify(backupFile()), 'replace'), /设置写入失败/);
    assert.deepEqual(await repo.exportAll(), before);
    assert.deepEqual(storage.snapshot().settings, { firstDayOfWeek: 2 });
    assert.equal(storage.snapshot().metadata, undefined);
  } finally {
    restoreChrome();
  }
});

test('replace 写入 metadata 失败时恢复任务、设置和旧 metadata', async () => {
  class FailingMetadataStorage extends InMemoryStorageArea {
    failNextMetadataWrite = false;

    async set(values) {
      if (this.failNextMetadataWrite && Object.hasOwn(values, 'metadata')) {
        this.failNextMetadataWrite = false;
        await super.set(values);
        throw new Error('metadata 写入失败');
      }
      await super.set(values);
    }
  }

  const storage = new FailingMetadataStorage();
  const restoreChrome = installStorage(storage);
  const repo = new InMemoryTaskRepository([BASE_TASK], [CATEGORY], [EVENT]);
  const backup = new BackupService(repo, { now: () => NOW, appVersion: '0.1.0' });
  try {
    await storage.set({
      settings: { firstDayOfWeek: 2 },
      metadata: { lastImportedAt: '2026-09-16T08:30:00.000Z' },
    });
    const before = await repo.exportAll();
    storage.failNextMetadataWrite = true;

    await assert.rejects(() => backup.importBackup(JSON.stringify(backupFile()), 'replace'), /metadata 写入失败/);
    assert.deepEqual(await repo.exportAll(), before);
    assert.deepEqual(storage.snapshot().settings, { firstDayOfWeek: 2 });
    assert.deepEqual(storage.snapshot().metadata, { lastImportedAt: '2026-09-16T08:30:00.000Z' });
  } finally {
    restoreChrome();
  }
});

test('不接受未知导入模式', async () => {
  const { backup, restoreChrome } = createBackupService();
  try {
    await assert.rejects(() => backup.importBackup(JSON.stringify(backupFile()), 'append'), ValidationError);
  } finally {
    restoreChrome();
  }
});

/* 资料仓库的替身：只需 BackupService 用到的那两个方法。 */
class FakeResourceRepository {
  constructor(resources = [], taskResources = []) {
    this.resources = resources;
    this.taskResources = taskResources;
  }

  async exportAll() {
    return structuredClone({ resources: this.resources, taskResources: this.taskResources });
  }

  async replaceAll(snapshot) {
    this.resources = snapshot.resources;
    this.taskResources = snapshot.taskResources;
  }
}

function createBackupServiceWithResources({ storage, resources, taskResources }) {
  const restoreChrome = installStorage(storage);
  const repo = new InMemoryTaskRepository([BASE_TASK], [CATEGORY], [EVENT]);
  const resourceRepository = new FakeResourceRepository(resources, taskResources);
  const backup = new BackupService(repo, {
    now: () => NOW,
    appVersion: '0.1.0',
    resourceRepository,
  });
  return { backup, repo, resourceRepository, restoreChrome };
}

test('清除所有数据清空业务数据但保留设置并清空 metadata', async () => {
  const storage = new InMemoryStorageArea();
  await storage.set({ settings: { theme: 'dark' }, metadata: { lastExportedAt: NOW } });
  const { backup, repo, restoreChrome } = createBackupService({
    tasks: [BASE_TASK],
    categories: [CATEGORY],
    events: [EVENT],
    tags: [TAG],
    recurringTemplates: [TEMPLATE],
    storage,
  });
  try {
    await backup.clearAllData();

    const snapshot = await repo.exportAll();
    assert.deepEqual(snapshot.tasks, []);
    assert.deepEqual(snapshot.categories, []);
    assert.deepEqual(snapshot.events, []);
    assert.deepEqual(snapshot.tags, []);
    assert.deepEqual(snapshot.recurringTemplates, []);

    const persisted = storage.snapshot();
    // 偏好是“在这台机器上我怎么看”，不属于业务数据。
    assert.deepEqual(persisted.settings, { theme: 'dark' });
    assert.deepEqual(persisted.metadata, {});
  } finally {
    restoreChrome();
  }
});

test('清除所有数据同时清空资料集合', async () => {
  const resource = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '资料' };
  const link = { taskId: SAME_ID, resourceId: resource.id };
  const { backup, resourceRepository, restoreChrome } = createBackupServiceWithResources({
    storage: new InMemoryStorageArea(),
    resources: [resource],
    taskResources: [link],
  });
  try {
    await backup.clearAllData();
    assert.deepEqual(resourceRepository.resources, []);
    assert.deepEqual(resourceRepository.taskResources, []);
  } finally {
    restoreChrome();
  }
});

test('清除所有数据失败时回滚任务数据且不写 metadata', async () => {
  class FailingReplaceRepository extends InMemoryTaskRepository {
    async replaceAll(snapshot) {
      // 只让“清空”这一步失败；回滚用的恢复点写入必须仍然可用。
      if ((snapshot.tasks ?? []).length === 0) throw new Error('事务失败');
      return super.replaceAll(snapshot);
    }
  }

  const storage = new InMemoryStorageArea();
  await storage.set({ settings: { theme: 'dark' }, metadata: { lastExportedAt: NOW } });
  const restoreChrome = installStorage(storage);
  const repo = new FailingReplaceRepository([BASE_TASK], [CATEGORY], [EVENT]);
  const backup = new BackupService(repo, { now: () => NOW, appVersion: '0.1.0' });
  try {
    await assert.rejects(() => backup.clearAllData(), /事务失败/);
    const snapshot = await repo.exportAll();
    assert.deepEqual(snapshot.tasks.map((task) => task.id), [SAME_ID]);
    assert.deepEqual(snapshot.categories.map((category) => category.id), [CATEGORY_ID]);
    assert.deepEqual(storage.snapshot().metadata, { lastExportedAt: NOW });
  } finally {
    restoreChrome();
  }
});

test('清除所有数据在未注入资源仓库时同样可用', async () => {
  const { backup, repo, restoreChrome } = createBackupService();
  try {
    await backup.clearAllData();
    assert.deepEqual((await repo.exportAll()).tasks, []);
  } finally {
    restoreChrome();
  }
});
