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

function localNoon(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12).toISOString();
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

test('plannedCount 合并当前计划与计划事件，并按任务和本地日期去重', async () => {
  const statistics = createStatistics([
    task({
      id: 'task-a',
      scheduledDate: '2026-09-15',
      firstScheduledDate: '2026-09-15',
    }),
    task({
      id: 'task-b',
      scheduledDate: null,
      firstScheduledDate: null,
    }),
  ], [
    event({
      id: 'task-a-same-day',
      taskId: 'task-a',
      type: 'POSTPONE',
      occurredAt: localNoon('2026-09-15'),
    }),
    event({
      id: 'task-a-postpone',
      taskId: 'task-a',
      type: 'POSTPONE',
      occurredAt: localNoon('2026-09-16'),
    }),
    event({
      id: 'task-a-reschedule',
      taskId: 'task-a',
      type: 'RESCHEDULE',
      occurredAt: localNoon('2026-09-17'),
    }),
    event({
      id: 'task-b-event',
      taskId: 'task-b',
      type: 'RESCHEDULE',
      occurredAt: localNoon('2026-09-16'),
    }),
    event({
      id: 'ignored-edit',
      taskId: 'task-b',
      type: 'EDIT',
      occurredAt: localNoon('2026-09-18'),
    }),
  ]);

  const weekly = await statistics.weekly('2026-09-14');

  assert.equal(weekly.plannedCount, 4);
  assert.equal(weekly.postponedCount, 2);
});

test('计划事件使用 occurredAt 的本地日期，不使用 detail.toDate', async () => {
  const statistics = createStatistics([
    task({ id: 'event-in-range', scheduledDate: null, firstScheduledDate: null }),
    task({ id: 'detail-in-range', scheduledDate: null, firstScheduledDate: null }),
  ], [
    event({
      id: 'event-in-range',
      taskId: 'event-in-range',
      occurredAt: localNoon('2026-09-16'),
      detail: { toDate: '2026-09-30' },
    }),
    event({
      id: 'detail-in-range',
      taskId: 'detail-in-range',
      occurredAt: localNoon('2026-09-30'),
      detail: { toDate: '2026-09-16' },
    }),
  ]);

  assert.equal((await statistics.weekly('2026-09-14')).plannedCount, 1);
});

test('已删除任务及其计划事件不进入统计', async () => {
  const statistics = createStatistics([
    task({
      id: 'trashed',
      scheduledDate: '2026-09-15',
      firstScheduledDate: '2026-09-15',
      trashedAt: NOW,
    }),
    task({ id: 'visible', scheduledDate: null, firstScheduledDate: null }),
  ], [
    event({
      id: 'trashed-current',
      taskId: 'trashed',
      occurredAt: localNoon('2026-09-16'),
    }),
    event({
      id: 'visible-event',
      taskId: 'visible',
      occurredAt: localNoon('2026-09-16'),
    }),
    event({
      id: 'missing-task',
      taskId: 'missing',
      occurredAt: localNoon('2026-09-17'),
    }),
  ]);

  const weekly = await statistics.weekly('2026-09-14');

  assert.equal(weekly.plannedCount, 1);
  assert.equal(weekly.cancelledCount, 0);
  assert.equal(weekly.postponedCount, 1);
});

test('完成率扣除区间内的取消任务实例', async () => {
  const statistics = createStatistics([
    task({
      id: 'cancelled-current',
      lifecycle: 'cancelled',
      scheduledDate: '2026-09-15',
      firstScheduledDate: '2026-08-01',
    }),
    task({
      id: 'cancelled-event',
      lifecycle: 'cancelled',
      scheduledDate: null,
      firstScheduledDate: '2026-08-01',
    }),
    task({
      id: 'active',
      lifecycle: 'completed',
      scheduledDate: '2026-09-17',
      firstScheduledDate: '2026-09-17',
      completedAt: localNoon('2026-09-17'),
    }),
  ], [
    event({
      id: 'cancelled-event',
      taskId: 'cancelled-event',
      type: 'RESCHEDULE',
      occurredAt: localNoon('2026-09-16'),
    }),
  ]);

  const weekly = await statistics.weekly('2026-09-14');

  assert.equal(weekly.plannedCount, 3);
  assert.equal(weekly.cancelledCount, 2);
  assert.equal(weekly.completedCount, 1);
  assert.equal(weekly.completionRate, 1);
});

test('取消全部计划实例时完成率为 null', async () => {
  const statistics = createStatistics([
    task({
      id: 'cancelled',
      lifecycle: 'cancelled',
      scheduledDate: '2026-09-15',
      firstScheduledDate: '2026-09-15',
    }),
  ]);

  const weekly = await statistics.weekly('2026-09-14');

  assert.equal(weekly.plannedCount, 1);
  assert.equal(weekly.cancelledCount, 1);
  assert.equal(weekly.completionRate, null);
  assert.equal(weekly.plannedCompletedCount, 0);
  assert.equal(weekly.carriedOverCompletedCount, 0);
});

test('计划并完成匹配首次或当前计划，历史延期完成只匹配开始日前首次计划', async () => {
  const statistics = createStatistics([
    task({
      id: 'first-hit',
      lifecycle: 'completed',
      firstScheduledDate: '2026-09-14',
      scheduledDate: '2026-09-21',
      completedAt: localNoon('2026-09-15'),
    }),
    task({
      id: 'current-hit',
      lifecycle: 'completed',
      firstScheduledDate: '2026-09-01',
      scheduledDate: '2026-09-16',
      completedAt: localNoon('2026-09-17'),
    }),
    task({
      id: 'neither',
      lifecycle: 'completed',
      firstScheduledDate: '2026-09-21',
      scheduledDate: null,
      completedAt: localNoon('2026-09-18'),
    }),
    task({
      id: 'completed-outside',
      lifecycle: 'completed',
      firstScheduledDate: '2026-09-01',
      scheduledDate: '2026-09-16',
      completedAt: localNoon('2026-09-21'),
    }),
    task({
      id: 'carried-only',
      lifecycle: 'completed',
      firstScheduledDate: '2026-09-01',
      scheduledDate: '2026-09-21',
      completedAt: localNoon('2026-09-19'),
    }),
  ]);

  const weekly = await statistics.weekly('2026-09-14');

  assert.equal(weekly.completedCount, 4);
  assert.equal(weekly.plannedCompletedCount, 2);
  assert.equal(weekly.carriedOverCompletedCount, 2);
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
  assert.equal(weekly.plannedCount, 3);
  assert.equal(weekly.postponedCount, 1);
  assert.equal(weekly.completionRate, 1 / 3);
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
