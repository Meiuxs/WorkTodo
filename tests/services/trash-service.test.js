import assert from 'node:assert/strict';
import test from 'node:test';

import { TaskQueryService } from '../../src/services/task-query-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { InMemoryTaskRepository } from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';

function taskFixture(overrides = {}) {
  const scheduledDate = overrides.scheduledDate ?? '2026-09-17';
  return {
    id: 'task',
    title: '任务',
    description: '',
    priority: 'none',
    starred: false,
    categoryId: null,
    tagIds: [],
    parentId: null,
    scheduledDate,
    firstScheduledDate: scheduledDate,
    startTime: null,
    dueTime: null,
    lifecycle: 'todo',
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    cancelledAt: null,
    trashedAt: null,
    seriesId: null,
    occurrenceKey: null,
    ...overrides,
  };
}

test('回收站只显示已删除任务并按删除时间倒序', async () => {
  const repository = new InMemoryTaskRepository([
    taskFixture({ id: 'older', trashedAt: '2026-09-16T08:00:00.000Z' }),
    taskFixture({ id: 'newer', trashedAt: '2026-09-17T08:00:00.000Z' }),
    taskFixture({ id: 'active', trashedAt: null }),
  ]);
  const query = new TaskQueryService(repository);

  assert.deepEqual((await query.trashed()).map((item) => item.id), ['newer', 'older']);
});

test('永久删除通过服务层委托仓库并返回已删除任务', async () => {
  const repository = new InMemoryTaskRepository([
    taskFixture({ id: 'deleted', trashedAt: NOW }),
  ]);
  const service = new TaskService(repository);

  const result = await service.permanentlyDelete('deleted', 0);

  assert.equal(result.task.id, 'deleted');
  assert.equal(await repository.get('deleted'), undefined);
});
