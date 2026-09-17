import assert from 'node:assert/strict';
import test from 'node:test';

import { TagService } from '../../src/services/tag-service.js';
import { InMemoryTagRepository } from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';
const EARLIER = '2026-09-16T08:30:00.000Z';

function taskFixture(overrides = {}) {
  return {
    id: 'task',
    title: '任务',
    description: '',
    priority: 'none',
    categoryId: null,
    parentId: null,
    tagIds: [],
    scheduledDate: '2026-09-17',
    firstScheduledDate: '2026-09-17',
    startTime: null,
    dueTime: null,
    seriesId: null,
    occurrenceKey: null,
    lifecycle: 'todo',
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    cancelledAt: null,
    trashedAt: null,
    ...overrides,
  };
}

test('创建标签会修剪名称并使用共享 ID 生成器', async () => {
  const repository = new InMemoryTagRepository();
  const service = new TagService(repository, { now: () => NOW });
  const created = await service.create('  客户  ');

  assert.equal(created.name, '客户');
  assert.equal(typeof created.id, 'string');
  assert.ok(created.id.length > 0);
  assert.deepEqual(await service.list(), [created]);
});

test('创建标签时重名冲突失败', async () => {
  const repository = new InMemoryTagRepository();
  let nextId = 1;
  const service = new TagService(repository, {
    now: () => NOW,
    generateId: () => `tag-${nextId++}`,
  });

  await service.create('客户');
  await assert.rejects(() => service.create(' 客户 '), /标签名称已存在/);
});

test('改名保留创建时间并更新时间', async () => {
  const repository = new InMemoryTagRepository();
  await repository.create({
    id: 'tag-1',
    name: '客户',
    createdAt: EARLIER,
    updatedAt: EARLIER,
  });
  const service = new TagService(repository, {
    now: () => NOW,
    generateId: () => 'tag-next',
  });

  const renamed = await service.rename('tag-1', '  重点客户  ');
  assert.deepEqual(renamed, {
    id: 'tag-1',
    name: '重点客户',
    createdAt: EARLIER,
    updatedAt: NOW,
  });
});

test('删除标签只解除任务引用，不删除任务或事件历史', async () => {
  const repository = new InMemoryTagRepository();
  const service = new TagService(repository, {
    now: () => NOW,
    generateId: () => 'tag-1',
  });
  const task = taskFixture({ id: 't1', tagIds: ['tag-1'] });
  const untouched = taskFixture({ id: 't2' });
  await repository.seedTask(task);
  await repository.seedTask(untouched);
  await service.create('客户');
  await service.deleteAndDetach('tag-1');

  const detached = await repository.getTask('t1');
  assert.deepEqual(detached.tagIds, []);
  assert.equal(detached.revision, 1);
  assert.equal(detached.updatedAt, NOW);
  assert.deepEqual(await repository.getTask('t2'), untouched);
  assert.equal(await repository.get('tag-1'), undefined);
  assert.deepEqual(
    (await repository.listEvents('t1')).map(({ type, detail }) => ({ type, detail })),
    [{ type: 'EDIT', detail: { removedTagId: 'tag-1' } }],
  );
});

test('删除标签失败时任务、事件与标签整体回滚', async () => {
  const repository = new InMemoryTagRepository();
  const service = new TagService(repository, {
    now: () => NOW,
    generateId: () => 'event-1',
  });
  await repository.seedTask(taskFixture({ id: 't1', tagIds: ['tag-1'] }));
  await repository.seedTask(taskFixture({ id: 't2', tagIds: ['tag-1'] }));
  await repository.create({
    id: 'tag-1',
    name: '客户',
    createdAt: NOW,
    updatedAt: NOW,
  });
  const before = await repository.exportAll();
  let sawPartialWrite = false;
  repository.failNextDeleteAndDetach(new Error('事务失败'), (partial) => {
    sawPartialWrite = true;
    assert.deepEqual(partial.tasks.find((task) => task.id === 't1').tagIds, []);
    assert.equal(partial.tasks.find((task) => task.id === 't1').revision, 1);
    assert.equal(partial.events.length, 1);
  });

  await assert.rejects(() => service.deleteAndDetach('tag-1'), /事务失败/);

  assert.equal(sawPartialWrite, true);
  assert.deepEqual(await repository.exportAll(), before);
  assert.deepEqual((await repository.getTask('t1')).tagIds, ['tag-1']);
  assert.equal((await repository.getTask('t1')).revision, 0);
  assert.ok(await repository.get('tag-1'));
  assert.deepEqual(await repository.listEvents('t1'), []);
});
