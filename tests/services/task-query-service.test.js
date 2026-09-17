import assert from 'node:assert/strict';
import test from 'node:test';

import { toLocalDate } from '../../src/domain/dates.js';
import { TaskQueryService } from '../../src/services/task-query-service.js';
import { InMemoryTaskRepository } from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';

function task(overrides = {}) {
  const scheduledDate = overrides.scheduledDate ?? '2026-09-17';
  return {
    id: 'task',
    title: '任务',
    description: '',
    priority: 'none',
    starred: false,
    categoryId: null,
    scheduledDate,
    firstScheduledDate: scheduledDate,
    startTime: null,
    dueTime: null,
    lifecycle: 'todo',
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    trashedAt: null,
    ...overrides,
  };
}

function createQuery(tasks) {
  const repository = new InMemoryTaskRepository(tasks);
  return { query: new TaskQueryService(repository), repository };
}

test('today 先返回逾期，再按星标、优先级、开始时间和创建时间排序', async () => {
  const tasks = [
    task({ id: 'newer', createdAt: '2026-09-17T08:05:00.000Z' }),
    task({ id: 'timed', startTime: '09:00', dueTime: '10:00', createdAt: '2026-09-17T08:00:00.000Z' }),
    task({ id: 'high', priority: 'high', createdAt: '2026-09-17T07:00:00.000Z' }),
    task({ id: 'starred', starred: true, createdAt: '2026-09-17T06:00:00.000Z' }),
    task({ id: 'overdue', scheduledDate: '2026-09-16', firstScheduledDate: '2026-09-16' }),
  ];
  const { query } = createQuery(tasks);

  const result = await query.today('2026-09-17');

  assert.deepEqual(result.map((item) => item.id), ['overdue', 'starred', 'high', 'timed', 'newer']);
});

test('today 不修改仓库返回的任务数组顺序', async () => {
  const tasks = [
    task({ id: 'later', createdAt: '2026-09-17T08:00:00.000Z' }),
    task({ id: 'starred', starred: true, createdAt: '2026-09-17T07:00:00.000Z' }),
    task({ id: 'overdue', scheduledDate: '2026-09-16', firstScheduledDate: '2026-09-16' }),
  ];
  const { query, repository } = createQuery(tasks);

  await query.today('2026-09-17');

  assert.deepEqual((await repository.list()).map((item) => item.id), ['later', 'starred', 'overdue']);
});

test('inbox、overdue 和 completed 忽略回收站任务并复用状态条件', async () => {
  const { query } = createQuery([
    task({ id: 'inbox', scheduledDate: null, firstScheduledDate: null }),
    task({ id: 'scheduled' }),
    task({ id: 'overdue', scheduledDate: '2026-09-16', firstScheduledDate: '2026-09-16' }),
    task({ id: 'done', lifecycle: 'completed', completedAt: '2026-09-17T09:00:00.000Z' }),
    task({ id: 'trashed-inbox', scheduledDate: null, firstScheduledDate: null, trashedAt: NOW }),
    task({ id: 'trashed-done', lifecycle: 'completed', completedAt: '2026-09-17T09:00:00.000Z', trashedAt: NOW }),
  ]);

  assert.deepEqual((await query.inbox()).map((item) => item.id), ['inbox']);
  assert.deepEqual((await query.overdue('2026-09-17')).map((item) => item.id), ['overdue']);
  assert.deepEqual((await query.completed()).map((item) => item.id), ['done']);
});

test('search 对标题和描述做大小写无关匹配并支持 filters', async () => {
  const { query } = createQuery([
    task({
      id: 'match-title',
      title: 'Call Alice',
      priority: 'high',
      starred: true,
      categoryId: 'sales',
      scheduledDate: '2026-09-17',
    }),
    task({
      id: 'match-description',
      title: 'Follow up',
      description: 'Discuss ALICE contract',
      priority: 'high',
      starred: true,
      categoryId: 'sales',
      scheduledDate: '2026-09-18',
    }),
    task({
      id: 'wrong-priority',
      title: 'Alice quote',
      priority: 'low',
      starred: true,
      categoryId: 'sales',
    }),
    task({
      id: 'trashed',
      title: 'Alice archive',
      priority: 'high',
      starred: true,
      categoryId: 'sales',
      trashedAt: NOW,
    }),
  ]);

  const result = await query.search({
    text: 'alice',
    categoryId: 'sales',
    priority: 'high',
    starred: true,
    fromDate: '2026-09-17',
    toDate: '2026-09-18',
  });

  assert.deepEqual(result.map((item) => item.id), ['match-title', 'match-description']);
});

test('search 按 tagId 过滤并与其他筛选条件取交集', async () => {
  const { query } = createQuery([
    task({ id: 'both', tagIds: ['customer', 'quote'], priority: 'high' }),
    task({ id: 'customer-only', tagIds: ['customer'], priority: 'low' }),
    task({ id: 'none', tagIds: [], priority: 'high' }),
  ]);

  const result = await query.search({ tagId: 'customer' });

  assert.deepEqual(result.map((item) => item.id), ['both', 'customer-only']);

  const combined = await query.search({ tagId: 'customer', priority: 'high' });

  assert.deepEqual(combined.map((item) => item.id), ['both']);
});

test('search 日期范围始终按 scheduledDate 过滤 completed 任务', async () => {
  const { query } = createQuery([
    task({
      id: 'scheduled-in-range',
      title: 'Alice planned',
      scheduledDate: '2026-09-17',
      lifecycle: 'completed',
      completedAt: '2026-09-20T09:00:00.000Z',
    }),
    task({
      id: 'completed-in-range-only',
      title: 'Alice completed',
      scheduledDate: '2026-09-20',
      firstScheduledDate: '2026-09-20',
      lifecycle: 'completed',
      completedAt: '2026-09-17T09:00:00.000Z',
    }),
  ]);

  const result = await query.search({
    text: 'alice',
    lifecycle: 'completed',
    fromDate: '2026-09-17',
    toDate: '2026-09-17',
  });

  assert.deepEqual(result.map((item) => item.id), ['scheduled-in-range']);
});

test('completed 与 cancelled 支持按实际完成日期和状态读取', async () => {
  const repository = new InMemoryTaskRepository([
    task({ id: 'completed-today', lifecycle: 'completed', completedAt: '2026-09-17T10:00:00.000Z' }),
    task({ id: 'completed-yesterday', lifecycle: 'completed', completedAt: '2026-09-16T10:00:00.000Z' }),
    task({ id: 'cancelled', lifecycle: 'cancelled', completedAt: null }),
  ]);
  const query = new TaskQueryService(repository);

  assert.deepEqual((await query.completed({ completedDate: '2026-09-17' })).map((item) => item.id), ['completed-today']);
  assert.deepEqual((await query.completed({ completedFrom: '2026-09-16', completedTo: '2026-09-16' })).map((item) => item.id), ['completed-yesterday']);
  assert.deepEqual((await query.cancelled()).map((item) => item.id), ['cancelled']);
});

test('完成日期筛选使用系统本地日期而不是 UTC 日期字符串', async () => {
  const completedAt = '2026-09-16T16:30:00.000Z';
  const localDate = toLocalDate(new Date(completedAt));
  assert.notEqual(completedAt.slice(0, 10), localDate);
  const { query } = createQuery([
    task({
      id: 'local-midnight',
      lifecycle: 'completed',
      completedAt,
    }),
  ]);

  assert.deepEqual(
    (await query.completed({ completedDate: localDate })).map((item) => item.id),
    ['local-midnight'],
  );
});
