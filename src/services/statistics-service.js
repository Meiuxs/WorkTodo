import { assertLocalDate, toLocalDate } from '../domain/dates.js';

function addDays(date, days) {
  assertLocalDate(date);
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

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

    const createdCount = visibleTasks.filter((task) => {
      const date = isoLocalDate(task.createdAt);
      return date !== null && inRange(date, startDate, endDate);
    }).length;
    const completedCount = visibleTasks.filter((task) => {
      const date = isoLocalDate(task.completedAt);
      return date !== null && inRange(date, startDate, endDate);
    }).length;
    const plannedCount = visibleTasks.filter((task) => (
      task.scheduledDate !== null && inRange(task.scheduledDate, startDate, endDate)
    )).length;
    const cancelledCount = visibleTasks.filter((task) => (
      task.lifecycle === 'cancelled'
      && task.scheduledDate !== null
      && inRange(task.scheduledDate, startDate, endDate)
    )).length;
    const postponedCount = events.filter((event) => {
      const date = isoLocalDate(event.occurredAt);
      return event.type === 'POSTPONE' && date !== null && inRange(date, startDate, endDate);
    }).length;

    return {
      createdCount,
      completedCount,
      postponedCount,
      plannedCount,
      cancelledCount,
      completionRate: completionRate(completedCount, plannedCount, cancelledCount),
    };
  }

  daily(date) {
    assertLocalDate(date);
    return this.#range(date, date);
  }

  weekly(weekStart) {
    assertLocalDate(weekStart, 'weekStart');
    return this.#range(weekStart, addDays(weekStart, 6));
  }
}
