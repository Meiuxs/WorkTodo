import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureIndexes } from '../../src/data/database.js';

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
