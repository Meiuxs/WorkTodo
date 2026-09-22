import { isSubtask } from '../domain/task.js';
import {
  addLocalDays,
  assertLocalDate,
  endOfMonth,
  startOfMonth,
  toLocalDate,
} from '../domain/dates.js';

function inRange(date, startDate, endDate) {
  return date >= startDate && date <= endDate;
}

function localDateBoundaryIso(date, dayOffset = 0) {
  const boundaryDate = dayOffset === 0 ? date : addLocalDays(date, dayOffset);
  const [year, month, day] = boundaryDate.split('-').map(Number);
  const boundary = new Date(0);
  boundary.setHours(0, 0, 0, 0);
  boundary.setFullYear(year, month - 1, day);
  return boundary.toISOString();
}

function isoLocalDate(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : toLocalDate(date);
}

function completionRate(completedCount, plannedCount, cancelledCount) {
  const denominator = plannedCount - cancelledCount;
  return denominator <= 0 ? null : completedCount / denominator;
}

const PLANNED_EVENT_TYPES = new Set(['POSTPONE', 'RESCHEDULE']);

export class StatisticsService {
  #repository;

  constructor(repository) {
    this.#repository = repository;
  }

  async #range(startDate, endDate) {
    assertLocalDate(startDate, 'startDate');
    assertLocalDate(endDate, 'endDate');
    const fromIso = localDateBoundaryIso(startDate);
    const toIso = localDateBoundaryIso(endDate, 1);
    const [createdTasks, completedTasks, plannedTasks, events] = await Promise.all([
      this.#repository.listCreated(fromIso, toIso, { trashedAt: null }),
      this.#repository.listCompleted(fromIso, toIso, { trashedAt: null }),
      this.#repository.listScheduled(startDate, endDate, { trashedAt: null }),
      this.#repository.listEventsByOccurredAt(
        fromIso,
        toIso,
        ['POSTPONE', 'RESCHEDULE'],
      ),
    ]);
    const tasksById = new Map(plannedTasks.map((task) => [task.id, task]));
    const missingTaskIds = [...new Set(events.map((event) => event.taskId))]
      .filter((taskId) => !tasksById.has(taskId));
    const eventTasks = missingTaskIds.length === 0
      ? []
      : await this.#repository.getMany(missingTaskIds);
    eventTasks.forEach((task) => tasksById.set(task.id, task));
    const visibleTasksById = new Map(
      [...tasksById]
        .filter(([, task]) => task.trashedAt === null),
    );
    const plannedDatesByTask = new Map();
    const addPlannedDate = (taskId, date) => {
      if (!visibleTasksById.has(taskId) || typeof date !== 'string' || !inRange(date, startDate, endDate)) {
        return;
      }
      if (!plannedDatesByTask.has(taskId)) plannedDatesByTask.set(taskId, new Set());
      plannedDatesByTask.get(taskId).add(date);
    };

    plannedTasks.forEach((task) => {
      addPlannedDate(task.id, task.scheduledDate);
    });
    events.forEach((event) => {
      if (!PLANNED_EVENT_TYPES.has(event.type)) return;
      // 改期事件按落点日期计入计划：只有被安排到区间内的日期才算该天计划过。
      // 从这一天移走（"放到其他日期"）或移除计划日期（toDate 为 null）都不新增计划；
      // 早期无 detail 的事件退回发生日期，保持旧数据可统计。
      const hasDetail = event.detail !== null && typeof event.detail === 'object';
      const plannedDate = hasDetail
        ? (typeof event.detail.toDate === 'string' ? event.detail.toDate : null)
        : isoLocalDate(event.occurredAt);
      addPlannedDate(event.taskId, plannedDate);
    });

    const createdCount = createdTasks.filter((task) => task.trashedAt === null).length;
    // 完成计数与计划总数保持同一口径：子任务没有独立计划日期（不计入 plannedCount），
    // 父任务级联完成的子任务也不计入实际完成，避免"4 / 1、完成率 400%"这种分子分母错位。
    const visibleCompletedTasks = completedTasks.filter((task) =>
      task.trashedAt === null && !isSubtask(task));
    const completedCount = visibleCompletedTasks.length;
    const plannedCount = [...plannedDatesByTask.values()]
      .reduce((total, dates) => total + dates.size, 0);
    const cancelledCount = [...plannedDatesByTask]
      .filter(([taskId]) => visibleTasksById.get(taskId).lifecycle === 'cancelled')
      .reduce((total, [, dates]) => total + dates.size, 0);
    const plannedCompletedCount = visibleCompletedTasks.filter((task) => {
      const firstDateInRange = typeof task.firstScheduledDate === 'string'
        && inRange(task.firstScheduledDate, startDate, endDate);
      const currentDateInRange = typeof task.scheduledDate === 'string'
        && inRange(task.scheduledDate, startDate, endDate);
      return firstDateInRange || currentDateInRange;
    }).length;
    const carriedOverCompletedCount = visibleCompletedTasks.filter((task) => {
      return typeof task.firstScheduledDate === 'string'
        && task.firstScheduledDate < startDate;
    }).length;
    const postponedCount = events.filter((event) => {
      const date = isoLocalDate(event.occurredAt);
      return event.type === 'POSTPONE'
        && visibleTasksById.has(event.taskId)
        && date !== null
        && inRange(date, startDate, endDate);
    }).length;

    return {
      createdCount,
      completedCount,
      postponedCount,
      plannedCount,
      cancelledCount,
      completionRate: completionRate(completedCount, plannedCount, cancelledCount),
      plannedCompletedCount,
      carriedOverCompletedCount,
    };
  }

  daily(date) {
    assertLocalDate(date);
    return this.#range(date, date);
  }

  weekly(weekStart) {
    assertLocalDate(weekStart, 'weekStart');
    return this.#range(weekStart, addLocalDays(weekStart, 6));
  }

  async weeklyDaily(weekStart) {
    assertLocalDate(weekStart, 'weekStart');
    return Promise.all(Array.from({ length: 7 }, (_, index) => {
      const date = addLocalDays(weekStart, index);
      return this.daily(date).then((summary) => ({ date, ...summary }));
    }));
  }

  monthly(anchorDate) {
    assertLocalDate(anchorDate, 'anchorDate');
    return this.#range(startOfMonth(anchorDate), endOfMonth(anchorDate));
  }
}
