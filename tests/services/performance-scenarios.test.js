import assert from 'node:assert/strict';
import test from 'node:test';

import { BackupService } from '../../src/services/backup-service.js';
import { StatisticsService } from '../../src/services/statistics-service.js';
import { TaskQueryService } from '../../src/services/task-query-service.js';
import { InMemoryStorageArea, InMemoryTaskRepository } from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';
const PRIORITY_RANK = { high: 3, medium: 2, low: 1, none: 0 };

function makeTasks(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    title: `任务 ${index}`,
    description: index % 25 === 0 ? '重点描述' : '',
    priority: index % 10 === 0 ? 'high' : 'none',
    categoryId: null,
    parentId: null,
    tagIds: [],
    seriesId: null,
    occurrenceKey: null,
    scheduledDate: index % 3 === 0 ? '2026-09-16' : '2026-09-17',
    firstScheduledDate: '2026-09-16',
    startTime: null,
    dueTime: null,
    lifecycle: 'todo',
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    cancelledAt: null,
    trashedAt: null,
  }));
}

function expectedRangeTaskIds(tasks, fromDate, toDate) {
  return tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => (
      task.scheduledDate >= fromDate
      && task.scheduledDate <= toDate
    ))
    .sort((left, right) => (
      left.task.scheduledDate.localeCompare(right.task.scheduledDate)
      || (PRIORITY_RANK[right.task.priority] ?? 0) - (PRIORITY_RANK[left.task.priority] ?? 0)
      || left.task.createdAt.localeCompare(right.task.createdAt)
      || left.index - right.index
    ))
    .map(({ task }) => task.id);
}

test('10,000 条任务的今日查询不修改输入且返回数组', async () => {
  const tasks = makeTasks(10_000);
  const original = structuredClone(tasks);
  const query = new TaskQueryService(new InMemoryTaskRepository(tasks));

  const result = await query.today('2026-09-17');

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 10_000);
  assert.deepEqual(tasks, original);
});

test('10,000 条任务的搜索、统计与导出保持可用且不修改仓库快照', async () => {
  const tasks = makeTasks(10_000);
  const repository = new InMemoryTaskRepository(tasks);
  const query = new TaskQueryService(repository);
  const statistics = new StatisticsService(repository);
  const before = await repository.exportAll();

  const searched = await query.search({ text: '重点描述' });
  const searchedAgain = await query.search({ text: '重点描述' });
  const daily = await statistics.daily('2026-09-17');
  const dailyAgain = await statistics.daily('2026-09-17');

  const previousChrome = globalThis.chrome;
  globalThis.chrome = { storage: { local: new InMemoryStorageArea() } };
  try {
    const backup = await new BackupService(repository, { now: () => NOW }).createBackup();
    assert.equal(backup.tasks.length, 10_000);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }

  assert.equal(searched.length, 400);
  assert.deepEqual(
    searchedAgain.map(({ id }) => id),
    searched.map(({ id }) => id),
  );
  assert.equal(daily.createdCount, 10_000);
  assert.deepEqual(dailyAgain, daily);
  assert.deepEqual(await repository.exportAll(), before);
});

test('10,000 条任务的本周和月历范围查询保持确定性', async () => {
  const tasks = makeTasks(10_000);
  const repository = new InMemoryTaskRepository(tasks);
  const query = new TaskQueryService(repository);
  const before = await repository.exportAll();

  const week = await query.week('2026-09-17');
  const weekAgain = await query.week('2026-09-17');
  const month = await query.month('2026-09-17');
  const monthAgain = await query.month('2026-09-17');
  const renderedDates = month.weeks.flat();

  assert.equal(week.days.length, 7);
  assert.ok(month.gridStart <= '2026-09-01');
  assert.ok(month.gridEnd >= '2026-09-30');
  assert.ok(month.weeks.every((weekDates) => weekDates.length === 7));
  assert.deepEqual(Object.keys(week.byDate), week.days);
  assert.deepEqual(Object.keys(month.byDate), renderedDates);
  assert.deepEqual(
    week.tasks.map(({ id }) => id),
    expectedRangeTaskIds(tasks, week.days[0], week.days.at(-1)),
  );
  assert.deepEqual(
    month.tasks.map(({ id }) => id),
    expectedRangeTaskIds(tasks, month.gridStart, month.gridEnd),
  );
  assert.deepEqual(weekAgain, week);
  assert.deepEqual(monthAgain, month);
  assert.deepEqual(await repository.exportAll(), before);
});
