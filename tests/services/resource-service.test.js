import assert from 'node:assert/strict';
import test from 'node:test';

import { ResourceService } from '../../src/services/resource-service.js';
import { ValidationError } from '../../src/domain/errors.js';

class MemoryResourceRepository {
  constructor() {
    this.resources = new Map();
    this.links = new Map();
  }

  async create(resource) { this.resources.set(resource.id, structuredClone(resource)); return structuredClone(resource); }
  async get(id) { return structuredClone(this.resources.get(id)); }
  async update(resource, expectedRevision) {
    const current = this.resources.get(resource.id);
    if (current.revision !== expectedRevision) throw new Error('revision');
    this.resources.set(resource.id, structuredClone(resource));
    return structuredClone(resource);
  }
  async list(options = {}) {
    return [...this.resources.values()].filter((resource) => !options.type || resource.type === options.type);
  }
  async attachTask(taskId, resourceId) { this.links.set(`${taskId}:${resourceId}`, { taskId, resourceId }); }
  async detachTask(taskId, resourceId) { this.links.delete(`${taskId}:${resourceId}`); }
  async listForTask(taskId) {
    return [...this.links.values()].filter((link) => link.taskId === taskId).map((link) => this.resources.get(link.resourceId));
  }
  async listTaskIds(resourceId) { return [...this.links.values()].filter((link) => link.resourceId === resourceId).map((link) => link.taskId); }
  async delete(id) { this.resources.delete(id); }
}

function service() {
  const repository = new MemoryResourceRepository();
  const resourceService = new ResourceService(repository, {
    generate: (() => { let n = 0; return () => `resource-${++n}`; })(),
    clock: (() => { let n = 0; return () => `2026-09-18T08:3${n++}:00.000Z`; })(),
  });
  return { repository, resourceService };
}

test('资料服务创建网页、片段和文件引用', async () => {
  const { repository, resourceService } = service();
  const url = await resourceService.createUrl({ title: '规范', url: 'https://example.com' });
  const snippet = await resourceService.createSnippet({ title: '结论', content: '先联调' });
  const file = await resourceService.createFile({ file: new Blob(['data'], { type: 'text/plain' }), saveCopy: false });
  assert.deepEqual([url.type, snippet.type, file.storageMode], ['url', 'snippet', 'reference']);
  assert.equal(repository.resources.size, 3);
});

test('资料关联可复用，删除关联资料前需要明确确认', async () => {
  const { repository, resourceService } = service();
  const resource = await resourceService.createUrl({ title: '共享资料', url: 'https://example.com' });
  await resourceService.attach('task-1', resource.id);
  await resourceService.attach('task-2', resource.id);
  assert.deepEqual(await resourceService.listTaskIds(resource.id), ['task-1', 'task-2']);
  await assert.rejects(() => resourceService.remove(resource.id), ValidationError);
  await resourceService.remove(resource.id, { force: true });
  assert.equal(repository.resources.has(resource.id), false);
});
