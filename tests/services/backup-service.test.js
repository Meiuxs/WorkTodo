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

const BASE_TASK = {
  id: SAME_ID,
  title: '本机较新版本',
  priority: 'none',
  categoryId: CATEGORY_ID,
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

function backupFile(overrides = {}) {
  return {
    schemaVersion: 1,
    appVersion: '0.1.0',
    exportedAt: NOW,
    tasks: [OTHER_TASK],
    categories: [],
    events: [OTHER_EVENT],
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

function createBackupService({ tasks = [BASE_TASK], categories = [CATEGORY], events = [EVENT], storage } = {}) {
  const restoreChrome = installStorage(storage);
  const repo = new InMemoryTaskRepository(tasks, categories, events);
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
    assert.equal(result.conflicts.length, 1);
    assert.equal((await repo.get(SAME_ID)).title, '本机较新版本');
  } finally {
    restoreChrome();
  }
});

test('导出包含版本和导出时间并记录 metadata', async () => {
  const storage = new InMemoryStorageArea();
  const { backup, restoreChrome } = createBackupService({ storage });
  try {
    const file = await backup.createBackup();
    assert.equal(file.schemaVersion, 1);
    assert.equal(file.appVersion, '0.1.0');
    assert.match(file.exportedAt, /T/);
    assert.equal(storage.snapshot().metadata.lastExportedAt, NOW);
  } finally {
    restoreChrome();
  }
});

test('严格校验顶层字段、schema 版本、UUID 唯一性和任务必需字段', async () => {
  const { backup, restoreChrome } = createBackupService();
  try {
    assert.throws(() => backup.validateBackup(JSON.stringify({ ...backupFile(), extra: true })), ValidationError);
    assert.throws(() => backup.validateBackup(JSON.stringify(backupFile({ schemaVersion: 2 }))), ValidationError);
    assert.throws(() => backup.validateBackup(JSON.stringify(backupFile({
      tasks: [OTHER_TASK, { ...OTHER_TASK, title: '重复 UUID' }],
    }))), ValidationError);
    assert.throws(() => backup.validateBackup(JSON.stringify(backupFile({
      tasks: [{ ...OTHER_TASK, title: '' }],
    }))), ValidationError);
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
      conflicts: preview.conflicts.map((conflict) => conflict.id),
    }, {
      taskCount: 2,
      categoryCount: 1,
      eventCount: 2,
      conflicts: [SAME_ID],
    });
    assert.deepEqual(await repo.exportAll(), before);
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
    assert.equal(result.conflicts.length, 1);
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

test('不接受未知导入模式', async () => {
  const { backup, restoreChrome } = createBackupService();
  try {
    await assert.rejects(() => backup.importBackup(JSON.stringify(backupFile()), 'append'), ValidationError);
  } finally {
    restoreChrome();
  }
});
