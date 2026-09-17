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

  async #snapshot() {
    if (typeof this.#repository.exportAll === 'function') {
      return this.#repository.exportAll();
    }
    return { tasks: await this.#repository.list(), events: [] };
  }

  async #range(startDate, endDate) {
    assertLocalDate(startDate, 'startDate');
    assertLocalDate(endDate, 'endDate');
    const { tasks, events } = await this.#snapshot();
    const visibleTasks = tasks.filter((task) => task.trashedAt === null);
    const visibleTasksById = new Map(visibleTasks.map((task) => [task.id, task]));
    const plannedDatesByTask = new Map();
    const addPlannedDate = (taskId, date) => {
      if (!visibleTasksById.has(taskId) || typeof date !== 'string' || !inRange(date, startDate, endDate)) {
        return;
      }
      if (!plannedDatesByTask.has(taskId)) plannedDatesByTask.set(taskId, new Set());
      plannedDatesByTask.get(taskId).add(date);
    };

    visibleTasks.forEach((task) => {
      addPlannedDate(task.id, task.scheduledDate);
    });
    events.forEach((event) => {
      if (!PLANNED_EVENT_TYPES.has(event.type)) return;
      addPlannedDate(event.taskId, isoLocalDate(event.occurredAt));
    });

    const createdCount = visibleTasks.filter((task) => {
      const date = isoLocalDate(task.createdAt);
      return date !== null && inRange(date, startDate, endDate);
    }).length;
    const completedCount = visibleTasks.filter((task) => {
      const date = isoLocalDate(task.completedAt);
      return date !== null && inRange(date, startDate, endDate);
    }).length;
    const plannedCount = [...plannedDatesByTask.values()]
      .reduce((total, dates) => total + dates.size, 0);
    const cancelledCount = [...plannedDatesByTask]
      .filter(([taskId]) => visibleTasksById.get(taskId).lifecycle === 'cancelled')
      .reduce((total, [, dates]) => total + dates.size, 0);
    const plannedCompletedCount = visibleTasks.filter((task) => {
      const completedDate = isoLocalDate(task.completedAt);
      if (completedDate === null || !inRange(completedDate, startDate, endDate)) return false;
      const firstDateInRange = typeof task.firstScheduledDate === 'string'
        && inRange(task.firstScheduledDate, startDate, endDate);
      const currentDateInRange = typeof task.scheduledDate === 'string'
        && inRange(task.scheduledDate, startDate, endDate);
      return firstDateInRange || currentDateInRange;
    }).length;
    const carriedOverCompletedCount = visibleTasks.filter((task) => {
      const completedDate = isoLocalDate(task.completedAt);
      return completedDate !== null
        && inRange(completedDate, startDate, endDate)
        && typeof task.firstScheduledDate === 'string'
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

  monthly(anchorDate) {
    assertLocalDate(anchorDate, 'anchorDate');
    return this.#range(startOfMonth(anchorDate), endOfMonth(anchorDate));
  }
}
