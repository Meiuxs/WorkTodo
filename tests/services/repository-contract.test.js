import assert from 'node:assert/strict';
import test from 'node:test';

import { ConflictError, TaskRepository } from '../../src/data/task-repository.js';
import { RecurringTemplateRepository } from '../../src/data/recurring-template-repository.js';
import { createSearchIndexRecord } from '../../src/data/search-index.js';
import { TagRepository } from '../../src/data/tag-repository.js';
import { SettingsRepository } from '../../src/data/settings-repository.js';
import { ValidationError } from '../../src/domain/errors.js';
import { createRecurringTemplate } from '../../src/domain/recurring-template.js';
import { createTask } from '../../src/domain/task.js';
import { createTaskEvent } from '../../src/domain/task-event.js';
import { BackupService } from '../../src/services/backup-service.js';
import { RecurringService } from '../../src/services/recurring-service.js';
import { TaskService } from '../../src/services/task-service.js';
import {
  InMemoryRecurringTemplateRepository,
  InMemoryStorageArea,
  InMemoryTaskRepository,
} from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';
const TASK_ID = '11111111-1111-4111-8111-111111111111';
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

globalThis.IDBKeyRange = {
  only: (value) => ({ includes: (key) => key === value }),
  bound: (lower, upper, lowerOpen = false, upperOpen = false) => ({
    includes: (key) => (
      (lowerOpen ? key > lower : key >= lower)
      && (upperOpen ? key < upper : key <= upper)
    ),
  }),
};

function asyncRequest(result) {
  const request = { result: structuredClone(result) };
  queueMicrotask(() => request.onsuccess?.());
  return request;
}

function keysFor(record, keyPath, multiEntry) {
  const value = record[keyPath];
  if (value === null || value === undefined) return [];
  if (multiEntry && Array.isArray(value)) return value;
  return [value];
}

class IndexedDbFake {
  #stores;

  constructor({ tasks = [], events = [], tags = [], taskResources = [] } = {}) {
    this.indexReads = [];
    this.transactionLog = [];
    this.#stores = new Map([
      ['tasks', new Map(tasks.map((task) => [task.id, structuredClone(task)]))],
      ['categories', new Map()],
      ['events', new Map(events.map((event) => [event.id, structuredClone(event)]))],
      ['tags', new Map(tags.map((tag) => [tag.id, structuredClone(tag)]))],
      ['recurringTemplates', new Map()],
      ['taskResources', new Map(taskResources.map((relation) => [`${relation.taskId}:${relation.resourceId}`, structuredClone(relation)]))],
      [
        'searchIndex',
        new Map(tasks.map((task) => {
          const record = createSearchIndexRecord(task);
          return [record.taskId, record];
        })),
      ],
    ]);
  }

  transaction(names, mode = 'readonly') {
    const storeNames = Array.isArray(names) ? [...names] : [names];
    for (const name of storeNames) {
      if (!this.#stores.has(name)) throw new Error(`store 不存在: ${name}`);
    }
    this.transactionLog.push({ storeNames, mode });
    const transaction = {};
    setTimeout(() => transaction.oncomplete?.(), 0);
    transaction.objectStore = (name) => this.#store(name);
    return transaction;
  }

  #store(name) {
    const database = this;
    const records = this.#stores.get(name);
    const keyPath = name === 'searchIndex' || name === 'taskResources' ? 'taskId' : 'id';
    const indexes = name === 'searchIndex'
      ? { grams: { keyPath: 'grams', multiEntry: true } }
      : {
          scheduledDate: { keyPath: 'scheduledDate' },
          lifecycle: { keyPath: 'lifecycle' },
          completedAt: { keyPath: 'completedAt' },
          createdAt: { keyPath: 'createdAt' },
          categoryId: { keyPath: 'categoryId' },
          trashedAt: { keyPath: 'trashedAt' },
          tagIds: { keyPath: 'tagIds', multiEntry: true },
          occurrenceKey: { keyPath: 'occurrenceKey' },
          parentId: { keyPath: 'parentId' },
          taskId: { keyPath: 'taskId' },
          occurredAt: { keyPath: 'occurredAt' },
        };
    const getRecords = (range) => [...records.values()]
      .filter((record) => range === undefined || range.includes(record[keyPath]))
      .sort((left, right) => compareIndexedKeys(left[keyPath], right[keyPath]))
      .map((record) => structuredClone(record));

    return {
      get(key) {
        const record = records.get(Array.isArray(key) ? key.join(':') : key);
        return asyncRequest(record);
      },
      getAll(range) {
        return asyncRequest(getRecords(range));
      },
      getAllKeys(range) {
        const values = [...records.values()]
          .filter((record) => range === undefined || range.includes(record[keyPath]))
          .map((record) => record[keyPath])
          .sort();
        return asyncRequest(values);
      },
      add(record) {
        const primaryKey = name === 'taskResources' ? `${record.taskId}:${record.resourceId}` : record[keyPath];
        if (records.has(primaryKey)) throw new Error('主键已存在');
        records.set(primaryKey, structuredClone(record));
      },
      put(record) {
        const primaryKey = name === 'taskResources' ? `${record.taskId}:${record.resourceId}` : record[keyPath];
        records.set(primaryKey, structuredClone(record));
      },
      clear() {
        records.clear();
      },
      delete(key) {
        records.delete(Array.isArray(key) ? key.join(':') : key);
      },
      index(indexName) {
        const definition = indexes[indexName];
        if (definition === undefined) throw new Error(`索引不存在: ${indexName}`);
        const matching = (range) => {
          database.indexReads.push({ storeName: name, indexName, range });
          return [...records.entries()]
            .map(([primaryKey, record]) => {
              const matchingKeys = keysFor(record, definition.keyPath, definition.multiEntry)
                .filter((key) => range === undefined || range.includes(key))
                .sort(compareIndexedKeys);
              return matchingKeys.length === 0
                ? null
                : { indexKey: matchingKeys[0], primaryKey, record };
            })
            .filter((entry) => entry !== null)
            .sort((left, right) => (
              compareIndexedKeys(left.indexKey, right.indexKey)
              || compareIndexedKeys(left.primaryKey, right.primaryKey)
            ));
        };
        return {
          get(range) {
            return asyncRequest(matching(range).at(0)?.record);
          },
          getAll(range) {
            return asyncRequest(matching(range).map(({ record }) => record));
          },
          getAllKeys(range) {
            const keys = matching(range)
              .map(({ primaryKey }) => primaryKey);
            return asyncRequest(keys);
          },
        };
      },
    };
  }

  snapshot() {
    return Object.fromEntries(
      [...this.#stores].map(([name, records]) => [
        name,
        structuredClone([...records.values()]),
      ]),
    );
  }
}

function compareIndexedKeys(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function indexedTask(overrides = {}) {
  return {
    ...BASE_TASK,
    id: 'task',
    scheduledDate: null,
    firstScheduledDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

class ConstraintRaceDatabase {
  #tasks = new Map();
  #reads = 0;

  constructor(task = null) {
    if (task !== null) this.#tasks.set(task.id, structuredClone(task));
  }

  transaction(names, mode = 'readonly') {
    const database = this;
    const transaction = {};
    setTimeout(() => transaction.oncomplete?.(), 0);
    transaction.objectStore = () => ({
      index() {
        return {
          get(key) {
            const shouldHide = database.#reads++ < 2;
            const value = shouldHide
              ? undefined
              : [...database.#tasks.values()].find((task) => task.occurrenceKey === key);
            return asyncRequest(value);
          },
        };
      },
      add(record) {
        if ([...database.#tasks.values()].some((task) => task.occurrenceKey === record.occurrenceKey)) {
          const error = new Error('唯一索引冲突');
          error.name = 'ConstraintError';
          throw error;
        }
        database.#tasks.set(record.id, structuredClone(record));
      },
      put() {},
    });
    return transaction;
  }
}

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
    if (
      value === null
      || typeof value !== 'object'
      || (value.id === undefined && value.taskId === undefined)
    ) {
      const error = new Error('对象缺少主键');
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
        const primaryKey = operation.value.id ?? operation.value.taskId;
        const index = values.findIndex((item) => (item.id ?? item.taskId) === primaryKey);
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

function createReadOnlyIndexedDb(tasks) {
  const values = {
    tasks: structuredClone(tasks),
    categories: [],
    events: [],
    tags: [],
    recurringTemplates: [],
  };

  function requestResultFor(result) {
    const request = { result: structuredClone(result) };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  }

  return {
    transaction() {
      const transaction = {};
      setTimeout(() => transaction.oncomplete?.(), 0);
      transaction.objectStore = (name) => ({
        get(id) {
          return requestResultFor(values[name].find((item) => item.id === id));
        },
        getAll() {
          return requestResultFor(values[name]);
        },
      });
      return transaction;
    },
  };
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

test('模板和首个实例在同一个仓库边界内可导出和替换', async () => {
  let sequence = 0;
  const now = () => NOW;
  const generateId = () => `recurring-${++sequence}`;
  const repo = new InMemoryTaskRepository();
  const templates = new InMemoryRecurringTemplateRepository();
  const service = new RecurringService({
    taskService: new TaskService(repo, { now, generateId }),
    taskRepository: repo,
    templateRepository: templates,
    now,
    generateId,
    subtaskService: null,
  });

  const created = await service.createTemplate({
    title: '每日站会',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'daily', interval: 1 },
  });

  const snapshot = await templates.exportAll();
  assert.equal(snapshot.templates.length, 1);
  assert.equal((await repo.get(created.task.id)).id, created.task.id);
});

test('创建重复模板首实例时同步维护搜索索引', async () => {
  const database = new IndexedDbFake();
  const templateRepository = new RecurringTemplateRepository(database);
  const template = createRecurringTemplate({
    title: '每日站会',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'daily', interval: 1 },
  }, NOW, 'template-search');
  const task = createTask({
    title: template.title,
    scheduledDate: template.scheduledDate,
    seriesId: template.id,
    occurrenceKey: `${template.id}:${template.scheduledDate}`,
  }, NOW, 'task-search');
  const event = createTaskEvent({
    id: 'event-search',
    taskId: task.id,
    type: 'CREATE',
    occurredAt: NOW,
    detail: { recurringTemplateId: template.id },
  });

  await templateRepository.createWithTask(template, task, event);

  const search = await new TaskRepository(database).search('每日站会');
  assert.deepEqual(search.map(({ id }) => id), [task.id]);
  assert.deepEqual(database.snapshot().searchIndex, [createSearchIndexRecord(task)]);
});

test('真实任务仓库可搜索生成的下一重复实例', async () => {
  const database = new IndexedDbFake();
  const taskRepository = new TaskRepository(database);
  const templateRepository = new RecurringTemplateRepository(database);
  let sequence = 0;
  const now = () => NOW;
  const generateId = () => `search-recurring-${++sequence}`;
  const taskService = new TaskService(taskRepository, { now, generateId });
  const service = new RecurringService({
    taskService,
    taskRepository,
    templateRepository,
    now,
    generateId,
  });
  const created = await service.createTemplate({
    title: '真实仓库搜索重复实例',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'daily', interval: 1 },
  });

  await service.generateNext(created.template.id, created.task.scheduledDate);

  assert.deepEqual(
    (await taskRepository.search('真实仓库搜索')).map((task) => task.scheduledDate),
    ['2026-09-17', '2026-09-18'],
  );
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

test('永久删除校验 revision 并原子删除任务、事件与搜索索引', async () => {
  const repo = new InMemoryTaskRepository(
    [{ ...BASE_TASK, trashedAt: NOW }],
    [],
    [{ ...EVENT, type: 'TRASH' }],
  );

  await assert.rejects(repo.permanentlyDelete('t1', 1), ConflictError);
  await repo.permanentlyDelete('t1', 0);

  assert.equal(await repo.get('t1'), undefined);
  assert.equal((await repo.exportAll()).events.length, 0);
});

test('永久删除拒绝非回收站任务并保留任务与事件', async () => {
  const repo = new InMemoryTaskRepository([BASE_TASK], [], [EVENT]);

  await assert.rejects(
    repo.permanentlyDelete(BASE_TASK.id, 0),
    (error) => error instanceof ValidationError
      && error.message === '只能永久删除回收站中的任务',
  );

  assert.ok(await repo.get(BASE_TASK.id));
  assert.equal((await repo.exportAll()).events.length, 1);
});

test('真实仓库永久删除事务覆盖 searchIndex', async () => {
  const database = new IndexedDbFake({
    tasks: [{ ...BASE_TASK, trashedAt: NOW }],
    events: [{ ...EVENT, type: 'TRASH' }],
  });
  const repository = new TaskRepository(database);

  await repository.permanentlyDelete('t1', 0);

  assert.equal(database.snapshot().searchIndex.length, 0);
  assert.deepEqual(
    database.transactionLog.at(-1).storeNames,
    ['tasks', 'events', 'searchIndex', 'taskResources'],
  );
});

test('listTrashed 只通过 trashedAt 索引读取回收站任务', async () => {
  const database = new IndexedDbFake({
    tasks: [
      { ...BASE_TASK, id: 'active' },
      { ...BASE_TASK, id: 'trashed', trashedAt: NOW },
    ],
  });
  const repository = new TaskRepository(database);

  assert.deepEqual((await repository.listTrashed()).map(({ id }) => id), ['trashed']);
  assert.equal(database.indexReads.at(-1).storeName, 'tasks');
  assert.equal(database.indexReads.at(-1).indexName, 'trashedAt');
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
    searchIndex: [],
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

test('TaskRepository 读取、列表和导出边界补齐旧任务关系字段并可生成合法 v2 备份', async () => {
  const legacyTask = {
    ...BASE_TASK,
    id: TASK_ID,
    categoryId: null,
  };
  delete legacyTask.parentId;
  delete legacyTask.tagIds;
  delete legacyTask.seriesId;
  delete legacyTask.occurrenceKey;

  const repository = new TaskRepository(createReadOnlyIndexedDb([legacyTask]));
  const backup = new BackupService(repository, {
    settingsRepository: new SettingsRepository(new InMemoryStorageArea()),
    now: () => NOW,
    appVersion: '0.1.0',
  });
  const expectedRelationships = {
    parentId: null,
    tagIds: [],
    seriesId: null,
    occurrenceKey: null,
  };

  const fetched = await repository.get(TASK_ID);
  const listed = await repository.list();
  const snapshot = await repository.exportAll();
  for (const task of [fetched, listed[0], snapshot.tasks[0]]) {
    assert.deepEqual(
      Object.fromEntries(Object.keys(expectedRelationships).map((field) => [field, task[field]])),
      expectedRelationships,
    );
  }

  const file = await backup.createBackup();
  assert.doesNotThrow(() => backup.validateBackup(JSON.stringify(file)));
});

test('TaskRepository 范围方法使用闭区间与半开区间边界并返回独立 clone', async () => {
  const tasks = [
    indexedTask({ id: 'scheduled-before', scheduledDate: '2026-09-16' }),
    indexedTask({ id: 'scheduled-start', scheduledDate: '2026-09-17' }),
    indexedTask({ id: 'scheduled-end', scheduledDate: '2026-09-18' }),
    indexedTask({ id: 'scheduled-after', scheduledDate: '2026-09-19' }),
    indexedTask({
      id: 'completed-start',
      scheduledDate: null,
      lifecycle: 'completed',
      completedAt: '2026-09-17T00:00:00.000Z',
    }),
    indexedTask({
      id: 'completed-end',
      scheduledDate: null,
      lifecycle: 'completed',
      completedAt: '2026-09-18T00:00:00.000Z',
    }),
    indexedTask({
      id: 'created-start',
      scheduledDate: null,
      createdAt: '2026-09-17T00:00:00.000Z',
    }),
    indexedTask({
      id: 'created-end',
      scheduledDate: null,
      createdAt: '2026-09-18T00:00:00.000Z',
    }),
    indexedTask({ id: 'cancelled', scheduledDate: null, lifecycle: 'cancelled' }),
  ];
  const events = [
    { id: 'event-start', taskId: 'scheduled-start', type: 'POSTPONE', occurredAt: '2026-09-17T00:00:00.000Z' },
    { id: 'event-end', taskId: 'scheduled-end', type: 'RESCHEDULE', occurredAt: '2026-09-18T00:00:00.000Z' },
    { id: 'event-other', taskId: 'scheduled-end', type: 'EDIT', occurredAt: '2026-09-17T12:00:00.000Z' },
  ];
  const repository = new TaskRepository(new IndexedDbFake({ tasks, events }));

  assert.deepEqual(
    (await repository.listScheduled('2026-09-17', '2026-09-18')).map(({ id }) => id),
    ['scheduled-start', 'scheduled-end'],
  );
  assert.deepEqual(
    (await repository.listCompleted(
      '2026-09-17T00:00:00.000Z',
      '2026-09-18T00:00:00.000Z',
    )).map(({ id }) => id),
    ['completed-start'],
  );
  assert.deepEqual(
    (await repository.listCreated(
      '2026-09-17T00:00:00.000Z',
      '2026-09-18T00:00:00.000Z',
    )).map(({ id }) => id),
    ['created-start'],
  );
  assert.deepEqual(
    (await repository.listByLifecycle('cancelled')).map(({ id }) => id),
    ['cancelled'],
  );
  assert.deepEqual(
    (await repository.listEventsByOccurredAt(
      '2026-09-17T00:00:00.000Z',
      '2026-09-18T00:00:00.000Z',
      ['POSTPONE'],
    )).map(({ id }) => id),
    ['event-start'],
  );

  const legacyTask = indexedTask({ id: 'legacy', title: '旧标题' });
  delete legacyTask.parentId;
  delete legacyTask.tagIds;
  delete legacyTask.seriesId;
  delete legacyTask.occurrenceKey;
  const legacyRepository = new TaskRepository(new IndexedDbFake({ tasks: [legacyTask] }));
  const [listed] = await legacyRepository.listByLifecycle('todo');
  listed.title = '外部修改';
  const fetchedLegacy = await legacyRepository.get('legacy');
  assert.equal(fetchedLegacy.title, '旧标题');
  assert.deepEqual(
    Object.fromEntries(
      ['parentId', 'tagIds', 'seriesId', 'occurrenceKey']
        .map((field) => [field, fetchedLegacy[field]]),
    ),
    {
      parentId: null,
      tagIds: [],
      seriesId: null,
      occurrenceKey: null,
    },
  );
});

test('TaskRepository.search 使用 gram 索引、真实包含校验并支持空查询', async () => {
  const tasks = [
    indexedTask({
      id: 'title',
      title: 'Call Alice',
      description: '',
    }),
    indexedTask({
      id: 'description',
      title: '跟进',
      description: 'Discuss ALICE\n合同',
    }),
    indexedTask({
      id: 'unicode',
      title: '项目 😀',
      description: '中文子串',
    }),
    indexedTask({
      id: 'false-positive',
      title: 'a猫x猫b',
      description: '',
    }),
    indexedTask({
      id: 'trashed',
      title: 'Alice archive',
      trashedAt: NOW,
    }),
  ];
  const database = new IndexedDbFake({ tasks });
  const repository = new TaskRepository(database);

  assert.deepEqual(
    (await repository.search('alice')).map(({ id }) => id),
    ['description', 'title'],
  );
  assert.deepEqual(
    (await repository.search('😀')).map(({ id }) => id),
    ['unicode'],
  );
  assert.deepEqual(
    (await repository.search('中文子串')).map(({ id }) => id),
    ['unicode'],
  );
  assert.deepEqual(await repository.search('a猫b'), []);

  database.indexReads.length = 0;
  assert.deepEqual(
    (await repository.search('')).map(({ id }) => id),
    ['description', 'false-positive', 'title', 'unicode'],
  );
  assert.equal(
    database.indexReads.some(({ storeName, indexName }) => (
      storeName === 'searchIndex' && indexName === 'grams'
    )),
    false,
  );
});

test('TaskRepository 在任务事务中增量维护搜索索引且 replaceAll 不返回派生字段', async () => {
  const database = new IndexedDbFake();
  const repository = new TaskRepository(database);

  const created = await repository.create(BASE_TASK, {
    ...EVENT,
    type: 'TASK_CREATED',
  });
  assert.equal(Object.hasOwn(created, 'grams'), false);
  assert.deepEqual(
    database.snapshot().searchIndex[0],
    createSearchIndexRecord(BASE_TASK),
  );
  assert.deepEqual(
    database.transactionLog.at(-1).storeNames,
    ['tasks', 'events', 'searchIndex'],
  );

  await repository.update({ ...BASE_TASK, title: '更新标题' }, 0, {
    ...EVENT,
    id: 'event-updated',
  });
  assert.ok(database.snapshot().searchIndex[0].grams.includes('更新'));
  const updateTransaction = database.transactionLog
    .findLast(({ mode }) => mode === 'readwrite');
  assert.deepEqual(
    updateTransaction.storeNames,
    ['tasks', 'events', 'searchIndex'],
  );
  assert.deepEqual(
    await repository.search('更新标题'),
    [{ ...BASE_TASK, title: '更新标题', revision: 1 }],
  );

  const replacement = {
    ...BASE_TASK,
    id: 't2',
    title: '替换任务',
    description: '替换描述',
  };
  await repository.replaceAll({
    tasks: [replacement],
    categories: [],
    events: [{ ...EVENT, id: 'event-replaced', taskId: replacement.id }],
  });
  assert.deepEqual(
    database.snapshot().searchIndex,
    [createSearchIndexRecord(replacement)],
  );
  assert.deepEqual(
    (await repository.search('替换描述')).map(({ id }) => id),
    ['t2'],
  );
  const replaced = await repository.get('t2');
  assert.equal(Object.hasOwn(replaced, 'grams'), false);
  const replaceTransaction = database.transactionLog
    .findLast(({ mode }) => mode === 'readwrite');
  assert.deepEqual(
    replaceTransaction.storeNames,
    ['tasks', 'categories', 'events', 'tags', 'recurringTemplates', 'searchIndex'],
  );
});

test('InMemoryTaskRepository 与真实仓库的新增查询语义一致', async () => {
  const tasks = [
    indexedTask({
      id: 'search-task-z',
      title: '任务 Z',
      scheduledDate: '2026-09-17',
      lifecycle: 'todo',
    }),
    indexedTask({
      id: 'search-task-a',
      title: '任务 A',
      scheduledDate: '2026-09-18',
      lifecycle: 'completed',
      completedAt: '2026-09-17T09:00:00.000Z',
    }),
    indexedTask({
      id: 'search-task-m',
      title: '任务 M',
      scheduledDate: null,
      lifecycle: 'cancelled',
      completedAt: null,
      cancelledAt: NOW,
    }),
  ];
  delete tasks[2].parentId;
  delete tasks[2].tagIds;
  delete tasks[2].seriesId;
  delete tasks[2].occurrenceKey;
  const events = [
    {
      id: 'e1',
      taskId: 'search-task-z',
      type: 'POSTPONE',
      occurredAt: '2026-09-17T10:00:00.000Z',
      detail: null,
    },
    {
      id: 'e2',
      taskId: 'search-task-a',
      type: 'EDIT',
      occurredAt: '2026-09-18T10:00:00.000Z',
      detail: null,
    },
  ];
  const real = new TaskRepository(new IndexedDbFake({ tasks, events }));
  const memory = new InMemoryTaskRepository(tasks, [], events);

  assert.deepEqual(
    await real.listScheduled('2026-09-17', '2026-09-18'),
    await memory.listScheduled('2026-09-17', '2026-09-18'),
  );
  assert.deepEqual(
    await real.listCompleted('2026-09-17T00:00:00.000Z', '2026-09-18T00:00:00.000Z'),
    await memory.listCompleted('2026-09-17T00:00:00.000Z', '2026-09-18T00:00:00.000Z'),
  );
  assert.deepEqual(
    await real.listCreated('2026-09-17T00:00:00.000Z', '2026-09-18T00:00:00.000Z'),
    await memory.listCreated('2026-09-17T00:00:00.000Z', '2026-09-18T00:00:00.000Z'),
  );
  assert.deepEqual(
    await real.listByLifecycle('cancelled'),
    await memory.listByLifecycle('cancelled'),
  );
  assert.deepEqual(
    await real.listEventsByOccurredAt(
      '2026-09-17T00:00:00.000Z',
      '2026-09-19T00:00:00.000Z',
      ['POSTPONE'],
    ),
    await memory.listEventsByOccurredAt(
      '2026-09-17T00:00:00.000Z',
      '2026-09-19T00:00:00.000Z',
      ['POSTPONE'],
    ),
  );
  assert.deepEqual(
    await real.search('任务'),
    await memory.search('任务'),
  );
  assert.deepEqual(
    await real.getMany(['search-task-z', 'missing', 'search-task-z']),
    await memory.getMany(['search-task-z', 'missing', 'search-task-z']),
  );
  assert.deepEqual(
    (await memory.search('任务')).map(({ id }) => id),
    ['search-task-a', 'search-task-m', 'search-task-z'],
  );
  const [legacyMemoryTask] = await memory.search('任务 M');
  assert.deepEqual(
    Object.fromEntries(
      ['parentId', 'tagIds', 'seriesId', 'occurrenceKey']
        .map((field) => [field, legacyMemoryTask[field]]),
    ),
    {
      parentId: null,
      tagIds: [],
      seriesId: null,
      occurrenceKey: null,
    },
  );
});

test('任务仓库按 occurrenceKey 查询并幂等创建', async () => {
  const task = indexedTask({
    id: 'occurrence-task',
    seriesId: 'template-1',
    occurrenceKey: 'template-1:2026-09-18',
  });
  const event = { ...EVENT, id: 'occurrence-event', taskId: task.id, type: 'CREATE' };
  const memory = new InMemoryTaskRepository();
  assert.equal(await memory.findByOccurrenceKey(task.occurrenceKey), undefined);
  const first = await memory.createIfOccurrenceAbsent(task, event);
  const second = await memory.createIfOccurrenceAbsent(
    { ...task, id: 'other-task' },
    { ...event, id: 'other-event', taskId: 'other-task' },
  );
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.task.id, task.id);
  assert.equal((await memory.findByOccurrenceKey(task.occurrenceKey)).id, task.id);
});

test('真实仓库契约在 occurrenceKey 唯一索引竞态时返回获胜实例', async () => {
  const first = indexedTask({
    id: 'winner',
    seriesId: 'template-race',
    occurrenceKey: 'template-race:2026-09-18',
  });
  const second = { ...first, id: 'loser' };
  const repository = new TaskRepository(new ConstraintRaceDatabase());

  const [left, right] = await Promise.all([
    repository.createIfOccurrenceAbsent(first, { ...EVENT, id: 'winner-event', taskId: first.id }),
    repository.createIfOccurrenceAbsent(second, { ...EVENT, id: 'loser-event', taskId: second.id }),
  ]);

  assert.equal(left.created, true);
  assert.equal(right.created, false);
  assert.equal(right.task.id, first.id);
});

test('TagRepository.deleteAndDetach 在同一事务同步搜索索引 revision', async () => {
  const database = new IndexedDbFake({
    tasks: [{ ...BASE_TASK, tagIds: [TAG_ID] }],
    tags: [TAG],
  });
  const repository = new TagRepository(database);

  await repository.deleteAndDetach(TAG_ID, {
    updatedAt: NOW,
    createEvent: (task) => ({
      ...EVENT,
      id: 'event-tag-detached',
      taskId: task.id,
      type: 'EDIT',
    }),
  });

  assert.deepEqual(
    database.transactionLog.at(-1).storeNames,
    ['tasks', 'tags', 'events', 'searchIndex'],
  );
  assert.equal(database.snapshot().searchIndex[0].revision, 1);
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
