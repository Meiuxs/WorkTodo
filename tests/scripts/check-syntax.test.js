import assert from 'node:assert/strict';
import test from 'node:test';

import { collectJavaScriptFiles } from '../../scripts/check-syntax.mjs';

test('语法检查工具递归收集 JavaScript 文件并按路径排序', async () => {
  const files = await collectJavaScriptFiles(new URL('../../src/', import.meta.url));

  assert.ok(files.length > 0);
  assert.deepEqual(files, [...files].sort());
  assert.ok(files.some((file) => file.replaceAll('\\', '/').endsWith('dashboard/task-list.js')));
  assert.ok(files.every((file) => file.endsWith('.js')));
});
