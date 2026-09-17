import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSearchGrams,
  createSearchIndexRecord,
  normalizeSearchQuery,
  normalizeSearchText,
  querySearchGrams,
} from '../../src/data/search-index.js';

test('搜索文本规范化大小写并保留标题与描述之间换行', () => {
  assert.equal(normalizeSearchQuery('  Alice  '), 'alice');
  assert.equal(normalizeSearchText('Call ALICE', '第二行'), 'call alice\n第二行');
});

test('gram 索引支持单字符、中文子串、多行描述与 Unicode 字符', () => {
  const grams = createSearchGrams('😀 Cafe', '第一行\nSecond');

  assert.ok(grams.includes('😀'));
  assert.ok(grams.includes('😀 '));
  assert.ok(grams.includes('第'));
  assert.ok(grams.includes('第一'));
  assert.ok(grams.includes('\n'));
  assert.ok(grams.includes('\ns'));
  assert.deepEqual(querySearchGrams('A'), ['a']);
  assert.deepEqual(querySearchGrams('😀'), ['😀']);
  assert.deepEqual(querySearchGrams('😀A'), ['😀a']);
  assert.deepEqual(querySearchGrams('任务'), ['任务']);
});

test('搜索索引记录包含 taskId、去重 gram 与 revision', () => {
  assert.deepEqual(
    createSearchIndexRecord({
      id: 'task-1',
      title: '任务',
      description: '任务详情',
      revision: 7,
    }),
    {
      taskId: 'task-1',
      grams: createSearchGrams('任务', '任务详情'),
      revision: 7,
    },
  );
});
