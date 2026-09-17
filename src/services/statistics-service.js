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
    const referencedTaskIds = new Set([
      ...plannedTasks.map((task) => task.id),
      ...events.map((event) => event.taskId),
    ]);
    const referencedTasks = await this.#repository.getMany([...referencedTaskIds]);
    const visibleTasksById = new Map(
      referencedTasks
        .filter((task) => task.trashedAt === null)
        .map((task) => [task.id, task]),
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
      addPlannedDate(event.taskId, isoLocalDate(event.occurredAt));
    });

    const createdCount = createdTasks.filter((task) => task.trashedAt === null).length;
    const completedCount = completedTasks.filter((task) => task.trashedAt === null).length;
    const plannedCount = [...plannedDatesByTask.values()]
      .reduce((total, dates) => total + dates.size, 0);
    const cancelledCount = [...plannedDatesByTask]
      .filter(([taskId]) => visibleTasksById.get(taskId).lifecycle === 'cancelled')
      .reduce((total, [, dates]) => total + dates.size, 0);
    const visibleCompletedTasks = completedTasks.filter((task) => task.trashedAt === null);
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

  monthly(anchorDate) {
    assertLocalDate(anchorDate, 'anchorDate');
    return this.#range(startOfMonth(anchorDate), endOfMonth(anchorDate));
  }
}
