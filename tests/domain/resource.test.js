import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/domain/errors.js';
import {
  MAX_RESOURCE_COPY_BYTES,
  MAX_RESOURCE_CONTENT_LENGTH,
  createResource,
  updateResource,
  validateResource,
} from '../../src/domain/resource.js';

const NOW = '2026-09-18T08:30:00.000Z';

test('网页资料只接受 http(s) 并修剪显示字段', () => {
  const resource = createResource({
    type: 'url',
    title: ' 项目说明 ',
    url: ' https://example.com/spec ',
    note: ' 评审入口 ',
  }, { id: 'resource-1', now: NOW });

  assert.equal(resource.title, '项目说明');
  assert.equal(resource.url, 'https://example.com/spec');
  assert.equal(resource.note, '评审入口');
  assert.equal(resource.storageMode, null);
  assert.throws(() => createResource({ type: 'url', title: 'x', url: 'javascript:alert(1)' }, { id: 'resource-2', now: NOW }), ValidationError);
});

test('文本片段、备注和文件副本有明确边界', () => {
  const snippet = createResource({
    type: 'snippet',
    title: '会议结论',
    content: '先完成接口联调',
  }, { id: 'resource-2', now: NOW });
  assert.equal(snippet.content, '先完成接口联调');
  assert.throws(() => createResource({ type: 'snippet', title: 'x', content: 'a'.repeat(MAX_RESOURCE_CONTENT_LENGTH + 1) }, { id: 'resource-3', now: NOW }), ValidationError);

  const file = createResource({
    type: 'file',
    title: '方案.docx',
    fileName: '方案.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 12,
    lastModified: 123,
    storageMode: 'reference',
  }, { id: 'resource-4', now: NOW });
  assert.equal(file.blob, null);
  assert.throws(() => createResource({
    type: 'file', title: 'big.bin', fileName: 'big.bin', size: MAX_RESOURCE_COPY_BYTES + 1, storageMode: 'copy', blob: new Blob(['x']),
  }, { id: 'resource-5', now: NOW }), ValidationError);
});

test('资料更新保留创建时间并递增 revision', () => {
  const resource = createResource({ type: 'snippet', title: '旧标题', content: '内容' }, { id: 'resource-6', now: NOW });
  const updated = updateResource(resource, { title: '新标题', updatedAt: '2026-09-18T09:00:00.000Z' });
  assert.equal(updated.title, '新标题');
  assert.equal(updated.createdAt, NOW);
  assert.equal(updated.revision, 1);
  assert.equal(validateResource(updated), true);
});
