import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DATABASE_VERSION,
  ensureIndexes,
  upgradeDatabase,
} from '../../src/data/database.js';

function createStore(name, options) {
  const indexes = [];

  return {
    name,
    options,
    indexNames: {
      contains: (indexName) => indexes.some((index) => index.name === indexName),
    },
    createIndex(indexName, keyPath, indexOptions) {
      indexes.push({ name: indexName, keyPath, options: indexOptions });
    },
    get createdIndexes() {
      return indexes;
    },
  };
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

test('schema v2 创建标签与重复模板 store 和关系索引', () => {
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

  assert.equal(DATABASE_VERSION, 2);
  assert.ok(database.objectStoreNames.contains('tags'));
  assert.ok(database.objectStoreNames.contains('recurringTemplates'));
  assert.deepEqual(stores.get('tags').options, { keyPath: 'id' });
  assert.deepEqual(stores.get('recurringTemplates').options, {
    keyPath: 'id',
  });
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
  assert.deepEqual(stores.get('tags').createdIndexes, [
    { name: 'name', keyPath: 'name', options: { unique: true } },
  ]);
  assert.deepEqual(stores.get('recurringTemplates').createdIndexes, [
    { name: 'active', keyPath: 'active', options: undefined },
  ]);
});

test('schema v2 复用现有 store 并补建缺失索引', () => {
  const tasks = createStore('tasks');
  tasks.createIndex('scheduledDate', 'scheduledDate');
  const stores = new Map([
    ['tasks', tasks],
    ['categories', createStore('categories')],
    ['events', createStore('events')],
    ['tags', createStore('tags')],
    ['recurringTemplates', createStore('recurringTemplates')],
  ]);
  const database = {
    objectStoreNames: {
      contains: (name) => stores.has(name),
    },
    createObjectStore: () => {
      assert.fail('升级时不应重建已有 store');
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
      'categoryId',
      'trashedAt',
      'parentId',
      'seriesId',
      'occurrenceKey',
      'tagIds',
    ],
  );
});
