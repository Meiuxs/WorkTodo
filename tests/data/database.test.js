import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DATABASE_VERSION,
  ensureIndexes,
  upgradeDatabase,
} from '../../src/data/database.js';

function createStore(name, options) {
  const indexes = [];
  const records = new Map();
  const keyPath = options?.keyPath ?? 'id';

  return {
    name,
    options,
    indexNames: {
      contains: (indexName) => indexes.some((index) => index.name === indexName),
    },
    createIndex(indexName, keyPath, indexOptions) {
      indexes.push({ name: indexName, keyPath, options: indexOptions });
    },
    openCursor() {
      const request = { result: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    put(record) {
      records.set(record[keyPath], structuredClone(record));
    },
    clear() {
      records.clear();
    },
    snapshot() {
      return structuredClone([...records.values()]);
    },
    get createdIndexes() {
      return indexes;
    },
  };
}

function createCursorStore(name, initialRecords = []) {
  const store = createStore(name);
  const records = new Map(initialRecords.map((record) => [record.id, structuredClone(record)]));

  store.openCursor = () => {
    const request = {};
    let index = 0;

    const advance = () => {
      if (index >= records.size) {
        request.result = null;
        request.onsuccess?.();
        return;
      }

      const [id, value] = [...records.entries()][index];
      request.result = {
        value: structuredClone(value),
        update(nextValue) {
          records.set(id, structuredClone(nextValue));
        },
        continue() {
          index += 1;
          queueMicrotask(advance);
        },
      };
      request.onsuccess?.();
    };

    queueMicrotask(advance);
    return request;
  };
  store.snapshot = () => structuredClone([...records.values()]);
  return store;
}

test('ensureIndexes 仅补建缺失索引', () => {
  const existing = new Set(['scheduledDate']);
  const created = [];
  const store = {
    indexNames: { contains: (name) => existing.has(name) },
    createIndex(name, keyPath) {
      created.push({ name, keyPath });
      existing.add(name);
    },
  };

  ensureIndexes(store, [
    ['scheduledDate', 'scheduledDate'],
    ['lifecycle', 'lifecycle'],
  ]);

  assert.deepEqual(created, [{ name: 'lifecycle', keyPath: 'lifecycle' }]);
});

test('ensureIndexes 透传索引选项', () => {
  const created = [];
  const store = {
    indexNames: { contains: () => false },
    createIndex(name, keyPath, options) {
      created.push({ name, keyPath, options });
    },
  };

  ensureIndexes(store, [
    ['occurrenceKey', 'occurrenceKey', { unique: true }],
  ]);

  assert.deepEqual(created, [
    {
      name: 'occurrenceKey',
      keyPath: 'occurrenceKey',
      options: { unique: true },
    },
  ]);
});

test('schema v4 创建搜索索引、资料与关联 store', () => {
  const stores = new Map([
    ['tasks', createStore('tasks')],
    ['categories', createStore('categories')],
    ['events', createStore('events')],
  ]);
  const database = {
    objectStoreNames: {
      contains: (name) => stores.has(name),
    },
    createObjectStore: (name, options) => {
      const store = createStore(name, options);
      stores.set(name, store);
      return store;
    },
    transaction: {
      objectStore: (name) => stores.get(name),
    },
  };

  upgradeDatabase(database);

  assert.equal(DATABASE_VERSION, 4);
  assert.ok(database.objectStoreNames.contains('searchIndex'));
  assert.deepEqual(stores.get('searchIndex').options, { keyPath: 'taskId' });
  assert.ok(database.objectStoreNames.contains('tags'));
  assert.ok(database.objectStoreNames.contains('recurringTemplates'));
  assert.deepEqual(stores.get('tags').options, { keyPath: 'id' });
  assert.deepEqual(stores.get('recurringTemplates').options, {
    keyPath: 'id',
  });
  assert.deepEqual(stores.get('resources').options, { keyPath: 'id' });
  assert.deepEqual(stores.get('taskResources').options, { keyPath: ['taskId', 'resourceId'] });
  assert.deepEqual(stores.get('resourceBlobs').options, { keyPath: 'id' });
  assert.deepEqual(stores.get('taskResources').createdIndexes, [
    { name: 'taskId', keyPath: 'taskId', options: undefined },
    { name: 'resourceId', keyPath: 'resourceId', options: undefined },
  ]);
  assert.deepEqual(
    stores.get('tasks').createdIndexes.map(({ name, keyPath, options }) => ({
      name,
      keyPath,
      options,
    })),
    [
      { name: 'scheduledDate', keyPath: 'scheduledDate', options: undefined },
      { name: 'lifecycle', keyPath: 'lifecycle', options: undefined },
      { name: 'completedAt', keyPath: 'completedAt', options: undefined },
      { name: 'createdAt', keyPath: 'createdAt', options: undefined },
      { name: 'categoryId', keyPath: 'categoryId', options: undefined },
      { name: 'trashedAt', keyPath: 'trashedAt', options: undefined },
      { name: 'parentId', keyPath: 'parentId', options: undefined },
      { name: 'seriesId', keyPath: 'seriesId', options: undefined },
      {
        name: 'occurrenceKey',
        keyPath: 'occurrenceKey',
        options: { unique: true },
      },
      {
        name: 'tagIds',
        keyPath: 'tagIds',
        options: { multiEntry: true },
      },
    ],
  );
  assert.deepEqual(stores.get('searchIndex').createdIndexes, [
    {
      name: 'grams',
      keyPath: 'grams',
      options: { multiEntry: true },
    },
  ]);
  assert.deepEqual(stores.get('tags').createdIndexes, [
    { name: 'name', keyPath: 'name', options: { unique: true } },
  ]);
  assert.deepEqual(stores.get('recurringTemplates').createdIndexes, [
    { name: 'active', keyPath: 'active', options: undefined },
  ]);
});

test('schema v4 复用现有 store、补建缺失索引并新增资料 store', () => {
  const tasks = createStore('tasks');
  tasks.createIndex('scheduledDate', 'scheduledDate');
  const stores = new Map([
    ['tasks', tasks],
    ['categories', createStore('categories')],
    ['events', createStore('events')],
    ['searchIndex', createStore('searchIndex', { keyPath: 'taskId' })],
    ['tags', createStore('tags')],
    ['recurringTemplates', createStore('recurringTemplates')],
  ]);
  const database = {
    objectStoreNames: {
      contains: (name) => stores.has(name),
    },
    createObjectStore: (name, options) => {
      assert.equal(['resources', 'taskResources', 'resourceBlobs'].includes(name), true);
      const store = createStore(name, options);
      stores.set(name, store);
      return store;
    },
    transaction: {
      objectStore: (name) => stores.get(name),
    },
  };

  upgradeDatabase(database);

  assert.equal(stores.get('tasks'), tasks);
  assert.deepEqual(
    tasks.createdIndexes.slice(1).map(({ name }) => name),
    [
      'lifecycle',
      'completedAt',
      'createdAt',
      'categoryId',
      'trashedAt',
      'parentId',
      'seriesId',
      'occurrenceKey',
      'tagIds',
    ],
  );
  assert.ok(stores.has('resources'));
  assert.ok(stores.has('taskResources'));
});

test('schema v3 游标迁移幂等补齐关系字段、保留旧字段并重建搜索索引', async () => {
  const legacyTask = {
    id: 'legacy',
    title: '旧任务',
    extra: '保留',
  };
  const explicitTask = {
    id: 'explicit',
    title: '已有关系字段',
    parentId: null,
    tagIds: ['tag-1'],
    seriesId: 'series-1',
    occurrenceKey: 'occurrence-1',
  };
  const tasks = createCursorStore('tasks', [legacyTask, explicitTask]);
  const stores = new Map([
    ['tasks', tasks],
    ['categories', createStore('categories')],
    ['events', createStore('events')],
  ]);
  const database = {
    objectStoreNames: {
      contains: (name) => stores.has(name),
    },
    createObjectStore: (name, options) => {
      const store = createStore(name, options);
      stores.set(name, store);
      return store;
    },
    transaction: {
      objectStore: (name) => stores.get(name),
    },
  };

  upgradeDatabase(database);
  upgradeDatabase(database);
  await new Promise((resolve) => setImmediate(resolve));

  const migrated = new Map(tasks.snapshot().map((task) => [task.id, task]));
  assert.deepEqual(migrated.get('legacy'), {
    ...legacyTask,
    parentId: null,
    tagIds: [],
    seriesId: null,
    occurrenceKey: null,
  });
  assert.deepEqual(migrated.get('explicit'), explicitTask);
  assert.deepEqual(
    stores.get('searchIndex').snapshot().map(({ taskId, grams, revision }) => ({
      taskId,
      grams,
      revision,
    })),
    [
      {
        taskId: 'legacy',
        grams: [
          '旧',
          '旧任',
          '任',
          '任务',
          '务',
          '务\n',
          '\n',
        ],
        revision: null,
      },
      {
        taskId: 'explicit',
        grams: [
          '已',
          '已有',
          '有',
          '有关',
          '关',
          '关系',
          '系',
          '系字',
          '字',
          '字段',
          '段',
          '段\n',
          '\n',
        ],
        revision: null,
      },
    ],
  );
});
