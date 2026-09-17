import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/domain/errors.js';
import { createTag } from '../../src/domain/tag.js';

const NOW = '2026-09-17T08:30:00.000Z';

test('标签名称修剪、去重并拒绝空名称', () => {
  assert.deepEqual(createTag({ name: ' 客户 ' }, NOW, 'tag-1'), {
    id: 'tag-1',
    name: '客户',
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.throws(() => createTag({ name: '   ' }, NOW, 'tag-2'), ValidationError);
  assert.throws(() => createTag({ name: null }, NOW, 'tag-3'), ValidationError);
});
