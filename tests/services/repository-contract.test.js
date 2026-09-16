import assert from 'node:assert/strict';
import test from 'node:test';

import { ConflictError } from '../../src/data/task-repository.js';
import { SettingsRepository } from '../../src/data/settings-repository.js';
import { InMemoryStorageArea, InMemoryTaskRepository } from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';
const BASE_TASK = {
  id: 't1',
  title: '报价',
  priority: 'none',
  categoryId: null,
  scheduledDate: '2026-09-17',
  firstScheduledDate: '2026-09-17',
  startTime: null,
  dueTime: null,
  lifecycle: 'todo',
  revision: 0,
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
  trashedAt: null,
};
const EVENT = { id: 'e1', taskId: 't1', type: 'TASK_UPDATED', occurredAt: NOW, detail: null };

test('update 在 revision 过期时拒绝静默覆盖', async () => {
  const currentTask = { ...BASE_TASK, revision: 1 };
  const repo = new InMemoryTaskRepository([currentTask]);
  await assert.rejects(
    repo.update({ ...currentTask, title: '旧编辑' }, 0, EVENT),
    ConflictError,
  );
});

test('exportAll 返回独立快照', async () => {
  const repo = new InMemoryTaskRepository([BASE_TASK]);
  const snapshot = await repo.exportAll();
  snapshot.tasks[0].title = '外部修改';
  assert.equal((await repo.get(BASE_TASK.id)).title, BASE_TASK.title);
});

test('create、get 与 list 返回独立快照', async () => {
  const repo = new InMemoryTaskRepository();
  const created = await repo.create(BASE_TASK, { ...EVENT, type: 'TASK_CREATED' });
  created.title = '外部修改';
  const listed = await repo.list({ lifecycle: 'todo' });
  listed[0].title = '另一处修改';
  assert.equal((await repo.get(BASE_TASK.id)).title, BASE_TASK.title);
});

test('update 原子地保存任务、事件并递增 revision', async () => {
  const repo = new InMemoryTaskRepository([BASE_TASK]);
  const updated = await repo.update({ ...BASE_TASK, title: '已更新' }, 0, EVENT);
  assert.equal(updated.revision, 1);
  assert.equal(updated.title, '已更新');
  assert.equal((await repo.exportAll()).events.length, 1);
});

test('replaceAll 替换数据且不复用传入快照', async () => {
  const repo = new InMemoryTaskRepository([BASE_TASK]);
  const snapshot = {
    tasks: [{ ...BASE_TASK, id: 't2', title: '导入任务' }],
    categories: [],
    events: [{ ...EVENT, taskId: 't2' }],
  };
  await repo.replaceAll(snapshot);
  snapshot.tasks[0].title = '外部修改';
  assert.equal((await repo.get('t1')), undefined);
  assert.equal((await repo.get('t2')).title, '导入任务');
});

test('settings 与 metadata 使用隔离键且返回独立快照', async () => {
  const local = new InMemoryStorageArea();
  const previousChrome = globalThis.chrome;
  globalThis.chrome = { storage: { local } };
  try {
    const repository = new SettingsRepository();
    const settings = { firstDayOfWeek: 1 };
    await repository.saveSettings(settings);
    await repository.saveMetadata({ lastExportAt: NOW });
    settings.firstDayOfWeek = 7;
    const readSettings = await repository.getSettings();
    readSettings.firstDayOfWeek = 2;
    assert.deepEqual(local.snapshot(), {
      settings: { firstDayOfWeek: 1 },
      metadata: { lastExportAt: NOW },
    });
    assert.equal((await repository.getSettings()).firstDayOfWeek, 1);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test('settings 拒绝将任务数组写入 chrome.storage.local', async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = { storage: { local: new InMemoryStorageArea() } };
  try {
    await assert.rejects(new SettingsRepository().saveSettings({ tasks: [BASE_TASK] }), TypeError);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});
