import {
  addLocalDays,
  assertLocalDate,
  eachLocalDate,
  endOfMonth,
  endOfWeek,
  isOverdueTask,
  startOfMonth,
  startOfWeek,
  toLocalDate,
} from '../domain/dates.js';
import { ValidationError } from '../domain/errors.js';
import { isInboxTask } from '../domain/task.js';

const PRIORITY_RANK = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};
const ACTIVE_LIFECYCLES = ['todo', 'in_progress'];
const MIN_LOCAL_DATE = '0001-01-01';
const MAX_LOCAL_DATE = '9999-12-31';
const MAX_LOCAL_DATE_UPPER_BOUND = '9999-12-31T23:59:59.999Z';

function isActiveTask(task) {
  return task.trashedAt === null && !['completed', 'cancelled'].includes(task.lifecycle);
}

function repositoryCriteria(filters = {}) {
  const criteria = { trashedAt: null };
  if (filters.lifecycle !== undefined) criteria.lifecycle = filters.lifecycle;
  if (filters.categoryId !== undefined) criteria.categoryId = filters.categoryId;
  return criteria;
}

function localDateBoundaryIso(date, dayOffset = 0) {
  const boundaryDate = dayOffset === 0 ? date : addLocalDays(date, dayOffset);
  const [year, month, day] = boundaryDate.split('-').map(Number);
  const boundary = new Date(0);
  boundary.setHours(0, 0, 0, 0);
  boundary.setFullYear(year, month - 1, day);
  return boundary.toISOString();
}

function nextLocalDateBoundaryIso(date) {
  return date === MAX_LOCAL_DATE
    ? MAX_LOCAL_DATE_UPPER_BOUND
    : localDateBoundaryIso(date, 1);
}

function mergeUniqueTasks(...groups) {
  const byId = new Map();
  for (const task of groups.flat()) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  return [...byId.values()];
}

function compareNullableText(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

function compareForWorkList(today) {
  return (left, right) => {
    const overdue = Number(isOverdueTask(right.task, today)) - Number(isOverdueTask(left.task, today));
    if (overdue !== 0) return overdue;

    const starred = Number(Boolean(right.task.starred)) - Number(Boolean(left.task.starred));
    if (starred !== 0) return starred;

    const priority = (PRIORITY_RANK[right.task.priority] ?? 0) - (PRIORITY_RANK[left.task.priority] ?? 0);
    if (priority !== 0) return priority;

    const startTime = compareNullableText(left.task.startTime, right.task.startTime);
    if (startTime !== 0) return startTime;

    const createdAt = left.task.createdAt.localeCompare(right.task.createdAt);
    if (createdAt !== 0) return createdAt;

    return left.index - right.index;
  };
}

function compareForRange() {
  return (left, right) => {
    const scheduledDate = left.task.scheduledDate.localeCompare(right.task.scheduledDate);
    if (scheduledDate !== 0) return scheduledDate;
    const startTime = compareNullableText(left.task.startTime, right.task.startTime);
    if (startTime !== 0) return startTime;
    const priority = (PRIORITY_RANK[right.task.priority] ?? 0) - (PRIORITY_RANK[left.task.priority] ?? 0);
    if (priority !== 0) return priority;
    const createdAt = left.task.createdAt.localeCompare(right.task.createdAt);
    if (createdAt !== 0) return createdAt;
    return left.index - right.index;
  };
}

function stableSort(tasks, compare) {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort(compare)
    .map(({ task }) => task);
}

function groupTasksByDate(tasks, dates) {
  const byDate = Object.fromEntries(dates.map((date) => [date, []]));
  for (const task of tasks) {
    if (task.scheduledDate !== null && byDate[task.scheduledDate] !== undefined) {
      byDate[task.scheduledDate].push(task);
    }
  }
  return byDate;
}

function matchesDateRange(task, filters) {
  const fromDate = filters.fromDate ?? filters.dateFrom ?? null;
  const toDate = filters.toDate ?? filters.dateTo ?? null;
  if (fromDate === null && toDate === null) return true;

  if (fromDate !== null) assertLocalDate(fromDate, 'fromDate');
  if (toDate !== null) assertLocalDate(toDate, 'toDate');

  if (task.scheduledDate === null) return false;
  if (fromDate !== null && task.scheduledDate < fromDate) return false;
  if (toDate !== null && task.scheduledDate > toDate) return false;
  return true;
}

function matchesFilters(task, filters = {}) {
  if (filters.lifecycle !== undefined && task.lifecycle !== filters.lifecycle) return false;
  if (filters.categoryId !== undefined && task.categoryId !== filters.categoryId) return false;
  if (filters.tagId !== undefined && !(task.tagIds ?? []).includes(filters.tagId)) return false;
  if (filters.priority !== undefined && task.priority !== filters.priority) return false;
  if (filters.starred !== undefined && Boolean(task.starred) !== filters.starred) return false;
  if (filters.completedDate !== undefined || filters.completedFrom !== undefined || filters.completedTo !== undefined) {
    if (filters.completedDate !== undefined) assertLocalDate(filters.completedDate, 'completedDate');
    if (filters.completedFrom !== undefined) assertLocalDate(filters.completedFrom, 'completedFrom');
    if (filters.completedTo !== undefined) assertLocalDate(filters.completedTo, 'completedTo');
    if (task.completedAt === null) return false;
    const completedDate = toLocalDate(new Date(task.completedAt));
    if (filters.completedDate !== undefined && completedDate !== filters.completedDate) return false;
    if (filters.completedFrom !== undefined && completedDate < filters.completedFrom) return false;
    if (filters.completedTo !== undefined && completedDate > filters.completedTo) return false;
  }
  return matchesDateRange(task, filters);
}

export class TaskQueryService {
  #repository;

  constructor(repository) {
    this.#repository = repository;
  }

  async inbox() {
    const tasks = mergeUniqueTasks(...await Promise.all(
      ACTIVE_LIFECYCLES.map((lifecycle) => this.#repository.listByLifecycle(lifecycle, {
        scheduledDate: null,
        trashedAt: null,
      })),
    ));
    return stableSort(
      tasks.filter((task) => isActiveTask(task) && isInboxTask(task)),
      compareForWorkList('9999-12-31'),
    );
  }

  async today(date) {
    assertLocalDate(date);
    const previousDate = date === MIN_LOCAL_DATE ? null : addLocalDays(date, -1);
    const [overdueTasks, todayTasks] = await Promise.all([
      previousDate === null
        ? Promise.resolve([])
        : this.#repository.listScheduled(MIN_LOCAL_DATE, previousDate, { trashedAt: null }),
      this.#repository.listScheduled(date, date, { trashedAt: null }),
    ]);
    const tasks = mergeUniqueTasks(overdueTasks, todayTasks);
    return stableSort(
      tasks.filter((task) => isActiveTask(task) && (isOverdueTask(task, date) || task.scheduledDate === date)),
      compareForWorkList(date),
    );
  }

  async overdue(date) {
    assertLocalDate(date);
    if (date === MIN_LOCAL_DATE) return [];
    const tasks = await this.#repository.listScheduled(
      MIN_LOCAL_DATE,
      addLocalDays(date, -1),
      { trashedAt: null },
    );
    return stableSort(
      tasks.filter((task) => isOverdueTask(task, date)),
      compareForWorkList(date),
    );
  }

  async range(fromDate, toDate, filters = {}) {
    assertLocalDate(fromDate, 'fromDate');
    assertLocalDate(toDate, 'toDate');
    if (fromDate > toDate) throw new ValidationError('fromDate 不能晚于 toDate');
    const tasks = await this.#repository.listScheduled(
      fromDate,
      toDate,
      repositoryCriteria(filters),
    );
    return stableSort(
      tasks.filter((task) => (
        task.trashedAt === null
        && matchesFilters(task, filters)
      )),
      compareForRange(),
    );
  }

  async tomorrow(anchorDate) {
    const date = addLocalDays(anchorDate, 1);
    return this.range(date, date);
  }

  async week(anchorDate) {
    const startDate = startOfWeek(anchorDate);
    const endDate = endOfWeek(anchorDate);
    const days = eachLocalDate(startDate, endDate);
    const tasks = await this.range(startDate, endDate);
    return { startDate, endDate, days, tasks, byDate: groupTasksByDate(tasks, days) };
  }

  async month(anchorDate) {
    const startDate = startOfMonth(anchorDate);
    const endDate = endOfMonth(anchorDate);
    const gridStart = startOfWeek(startDate);
    const gridEnd = endOfWeek(endDate);
    const allDates = eachLocalDate(gridStart, gridEnd);
    const tasks = await this.range(gridStart, gridEnd);
    return {
      month: anchorDate.slice(0, 7),
      startDate,
      endDate,
      gridStart,
      gridEnd,
      weeks: Array.from({ length: allDates.length / 7 }, (_, index) => allDates.slice(index * 7, index * 7 + 7)),
      tasks,
      byDate: groupTasksByDate(tasks, allDates),
    };
  }

  async completed(filters = {}) {
    if (filters.completedDate !== undefined) assertLocalDate(filters.completedDate, 'completedDate');
    if (filters.completedFrom !== undefined) assertLocalDate(filters.completedFrom, 'completedFrom');
    if (filters.completedTo !== undefined) assertLocalDate(filters.completedTo, 'completedTo');

    const hasCompletedRange = filters.completedDate !== undefined
      || filters.completedFrom !== undefined
      || filters.completedTo !== undefined;
    let tasks;
    if (hasCompletedRange) {
      let fromDate = filters.completedFrom ?? MIN_LOCAL_DATE;
      let toDate = filters.completedTo ?? MAX_LOCAL_DATE;
      if (filters.completedDate !== undefined) {
        fromDate = fromDate === null
          ? filters.completedDate
          : [fromDate, filters.completedDate].sort().at(-1);
        toDate = [toDate, filters.completedDate].sort()[0];
      }
      if (fromDate > toDate) return [];
      tasks = await this.#repository.listCompleted(
        localDateBoundaryIso(fromDate),
        nextLocalDateBoundaryIso(toDate),
        { lifecycle: 'completed', trashedAt: null },
      );
    } else {
      tasks = await this.#repository.listByLifecycle('completed', { trashedAt: null });
    }
    return tasks.filter((task) => (
      task.trashedAt === null
      && task.lifecycle === 'completed'
      && matchesFilters(task, { ...filters, lifecycle: 'completed' })
    ));
  }

  async cancelled(filters = {}) {
    const tasks = await this.#repository.listByLifecycle('cancelled', {
      ...repositoryCriteria(filters),
      lifecycle: 'cancelled',
    });
    return tasks.filter((task) => (
      task.trashedAt === null
      && task.lifecycle === 'cancelled'
      && matchesFilters(task, { ...filters, lifecycle: 'cancelled' })
    ));
  }

  async search(filters = {}) {
    const text = filters.text ?? filters.query ?? '';
    const tasks = await this.#repository.search(text);
    return tasks.filter((task) => {
      if (task.trashedAt !== null) return false;
      if (!matchesFilters(task, filters)) return false;
      return true;
    });
  }
}
