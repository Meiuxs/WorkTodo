import assert from 'node:assert/strict';
import test from 'node:test';

import { ConflictError, TaskRepository } from '../../src/data/task-repository.js';
import { SettingsRepository } from '../../src/data/settings-repository.js';
import { InMemoryStorageArea, InMemoryTaskRepository } from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';
const TAG_ID = '66666666-6666-4666-8666-666666666666';
const TEMPLATE_ID = '77777777-7777-4777-8777-777777777777';
const BASE_TASK = {
  id: 't1',
  title: '报价',
  priority: 'none',
  categoryId: null,
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
  updatedAt: NOW,
  completedAt: null,
  trashedAt: null,
};
const EVENT = { id: 'e1', taskId: 't1', type: 'TASK_UPDATED', occurredAt: NOW, detail: null };
const TAG = { id: TAG_ID, name: '客户', createdAt: NOW, updatedAt: NOW };
const TEMPLATE = { id: TEMPLATE_ID, title: '周报', active: true, updatedAt: NOW };

class SimulatedStore {
  #transaction;
  #name;

  constructor(transaction, name) {
    this.#transaction = transaction;
    this.#name = name;
  }

  clear() {
    this.#transaction.enqueue({ type: 'clear', name: this.#name });
  }

  put(value) {
    if (value === null || typeof value !== 'object' || value.id === undefined) {
      const error = new Error('对象缺少 id');
      error.name = 'DataError';
      throw error;
    }
    this.#transaction.enqueue({
      type: 'put',
      name: this.#name,
      value: structuredClone(value),
    });
  }
}

class SimulatedTransaction {
  #stores;
  #operations = [];
  #commitScheduled = false;

  constructor(stores) {
    this.#stores = stores;
    this.abortCalled = false;
    this.aborted = false;
    this.finished = false;
    this.error = null;
  }

  objectStore(name) {
    return new SimulatedStore(this, name);
  }

  enqueue(operation) {
    this.#operations.push(operation);
    if (!this.#commitScheduled) {
      this.#commitScheduled = true;
      queueMicrotask(() => this.#commit());
    }
  }

  abort() {
    this.abortCalled = true;
    if (this.finished) throw new Error('事务已结束');
    this.aborted = true;
    this.error ??= new Error('事务已中止');
    queueMicrotask(() => {
      if (this.finished) return;
      this.finished = true;
      this.onabort?.();
    });
  }

  #commit() {
    if (this.finished || this.aborted) return;
    for (const operation of this.#operations) {
      if (operation.type === 'clear') {
        this.#stores.set(operation.name, []);
      } else {
        const values = this.#stores.get(operation.name);
        const index = values.findIndex((item) => item.id === operation.value.id);
        if (index === -1) values.push(operation.value);
        else values[index] = operation.value;
      }
    }
    this.finished = true;
    this.oncomplete?.();
  }
}

class SimulatedIndexedDb {
  #stores;

  constructor(stores) {
    this.#stores = new Map(
      Object.entries(stores).map(([name, values]) => [name, structuredClone(values)]),
    );
    this.lastTransaction = null;
  }

  transaction(storeNames, mode) {
    if (mode !== 'readwrite') throw new Error('测试仅支持 readwrite 事务');
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    if (names.some((name) => !this.#stores.has(name))) {
      throw new Error('store 不存在');
    }
    const transaction = new SimulatedTransaction(this.#stores);
    this.lastTransaction = transaction;
    return transaction;
  }

  snapshot() {
    return structuredClone(Object.fromEntries(this.#stores));
  }
}

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

test('exportAll 与 replaceAll round-trip 标签和重复模板并返回独立快照', async () => {
  const repo = new InMemoryTaskRepository([], [], [], [TAG], [TEMPLATE]);
  const exported = await repo.exportAll();
  assert.deepEqual(exported.tags, [TAG]);
  assert.deepEqual(exported.recurringTemplates, [TEMPLATE]);

  exported.tags[0].name = '外部修改';
  exported.recurringTemplates[0].active = false;
  assert.deepEqual((await repo.exportAll()).tags, [TAG]);
  assert.deepEqual((await repo.exportAll()).recurringTemplates, [TEMPLATE]);

  const snapshot = {
    tasks: [],
    categories: [],
    events: [],
    tags: [{ ...TAG, name: '重点客户' }],
    recurringTemplates: [{ ...TEMPLATE, active: false }],
  };
  await repo.replaceAll(snapshot);
  snapshot.tags[0].name = '再次外部修改';
  snapshot.recurringTemplates[0].active = true;

  const replaced = await repo.exportAll();
  assert.deepEqual(replaced.tags, [{ ...TAG, name: '重点客户' }]);
  assert.deepEqual(replaced.recurringTemplates, [{ ...TEMPLATE, active: false }]);
});

test('TaskRepository.replaceAll 同步 put 失败时显式 abort 并保留五个 store', async () => {
  const database = new SimulatedIndexedDb({
    tasks: [BASE_TASK],
    categories: [],
    events: [EVENT],
    tags: [TAG],
    recurringTemplates: [TEMPLATE],
  });
  const repository = new TaskRepository(database);
  const before = database.snapshot();

  await assert.rejects(
    () => repository.replaceAll({
      tasks: [],
      categories: [],
      events: [],
      tags: [{}],
      recurringTemplates: [],
    }),
    (error) => error.name === 'DataError',
  );

  assert.equal(database.lastTransaction.abortCalled, true);
  assert.deepEqual(database.snapshot(), before);
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
