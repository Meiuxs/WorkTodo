import assert from 'node:assert/strict';
import test from 'node:test';

import { toLocalDate } from '../../src/domain/dates.js';
import { StatisticsService } from '../../src/services/statistics-service.js';
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
    cancelledAt: null,
    trashedAt: null,
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: 'event',
    taskId: 'task',
    type: 'POSTPONE',
    occurredAt: NOW,
    detail: null,
    ...overrides,
  };
}

function createStatistics(tasks, events = []) {
  return new StatisticsService(new InMemoryTaskRepository(tasks, [], events));
}

test('每日工作记录按 completedAt 而非 scheduledDate 统计', async () => {
  const statistics = createStatistics([
    task({ id: 'planned-open' }),
    task({
      id: 'completed-today',
      lifecycle: 'completed',
      scheduledDate: '2026-09-16',
      firstScheduledDate: '2026-09-16',
      completedAt: '2026-09-17T09:00:00.000Z',
    }),
    task({
      id: 'planned-completed-before',
      lifecycle: 'completed',
      completedAt: '2026-09-16T09:00:00.000Z',
    }),
  ]);

  const daily = await statistics.daily('2026-09-17');

  assert.equal(daily.completedCount, 1);
  assert.equal(daily.plannedCount, 2);
  assert.equal(daily.completionRate, 0.5);
});

test('没有有效计划任务时完成率为 null', async () => {
  const statistics = createStatistics([
    task({ id: 'inbox', scheduledDate: null, firstScheduledDate: null }),
    task({
      id: 'completed-without-plan',
      scheduledDate: '2026-09-17',
      firstScheduledDate: '2026-09-17',
      lifecycle: 'completed',
      completedAt: '2026-09-18T09:00:00.000Z',
    }),
  ]);

  assert.equal((await statistics.daily('2026-09-18')).completionRate, null);
});

test('daily 统计创建、取消和 POSTPONE 事件', async () => {
  const statistics = createStatistics([
    task({ id: 'created-today', createdAt: '2026-09-17T01:00:00.000Z' }),
    task({ id: 'cancelled', lifecycle: 'cancelled', cancelledAt: '2026-09-17T02:00:00.000Z' }),
    task({ id: 'trashed', trashedAt: NOW }),
  ], [
    event({ id: 'postpone-1', taskId: 'created-today', occurredAt: '2026-09-17T03:00:00.000Z' }),
    event({ id: 'postpone-2', taskId: 'cancelled', occurredAt: '2026-09-18T03:00:00.000Z' }),
  ]);

  const daily = await statistics.daily('2026-09-17');

  assert.equal(daily.createdCount, 2);
  assert.equal(daily.cancelledCount, 1);
  assert.equal(daily.postponedCount, 1);
  assert.equal(daily.plannedCount, 2);
  assert.equal(daily.completionRate, 0);
});

test('weekly 聚合 weekStart 起连续七天', async () => {
  const statistics = createStatistics([
    task({ id: 'week-start', scheduledDate: '2026-09-14', firstScheduledDate: '2026-09-14' }),
    task({
      id: 'week-end',
      scheduledDate: '2026-09-20',
      firstScheduledDate: '2026-09-20',
      lifecycle: 'completed',
      completedAt: '2026-09-20T09:00:00.000Z',
    }),
    task({
      id: 'outside',
      scheduledDate: '2026-09-21',
      firstScheduledDate: '2026-09-21',
      lifecycle: 'completed',
      completedAt: '2026-09-21T09:00:00.000Z',
    }),
  ], [
    event({ id: 'postpone-in-week', taskId: 'week-start', occurredAt: '2026-09-19T03:00:00.000Z' }),
    event({ id: 'postpone-outside', taskId: 'outside', occurredAt: '2026-09-21T03:00:00.000Z' }),
  ]);

  const weekly = await statistics.weekly('2026-09-14');

  assert.equal(weekly.completedCount, 1);
  assert.equal(weekly.plannedCount, 2);
  assert.equal(weekly.postponedCount, 1);
  assert.equal(weekly.completionRate, 0.5);
});

test('完成统计使用系统本地日期而不是 UTC 日期字符串', async () => {
  const completedAt = '2026-09-16T16:30:00.000Z';
  const localDate = toLocalDate(new Date(completedAt));
  assert.notEqual(completedAt.slice(0, 10), localDate);
  const statistics = createStatistics([
    task({
      id: 'local-midnight',
      lifecycle: 'completed',
      completedAt,
    }),
  ]);

  assert.equal((await statistics.daily(localDate)).completedCount, 1);
});
