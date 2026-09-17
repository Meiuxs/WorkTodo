import { assertLocalDate, isOverdueTask, toLocalDate } from '../domain/dates.js';
import { isInboxTask } from '../domain/task.js';

const PRIORITY_RANK = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

function isActiveTask(task) {
  return task.trashedAt === null && !['completed', 'cancelled'].includes(task.lifecycle);
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

function stableSort(tasks, compare) {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort(compare)
    .map(({ task }) => task);
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

  async #tasks() {
    return this.#repository.list();
  }

  async inbox() {
    const tasks = await this.#tasks();
    return stableSort(
      tasks.filter((task) => isActiveTask(task) && isInboxTask(task)),
      compareForWorkList('9999-12-31'),
    );
  }

  async today(date) {
    assertLocalDate(date);
    const tasks = await this.#tasks();
    return stableSort(
      tasks.filter((task) => isActiveTask(task) && (isOverdueTask(task, date) || task.scheduledDate === date)),
      compareForWorkList(date),
    );
  }

  async overdue(date) {
    assertLocalDate(date);
    const tasks = await this.#tasks();
    return stableSort(
      tasks.filter((task) => isOverdueTask(task, date)),
      compareForWorkList(date),
    );
  }

  async completed(filters = {}) {
    const tasks = await this.#tasks();
    return tasks.filter((task) => (
      task.trashedAt === null
      && task.lifecycle === 'completed'
      && matchesFilters(task, { ...filters, lifecycle: 'completed' })
    ));
  }

  async cancelled(filters = {}) {
    const tasks = await this.#tasks();
    return tasks.filter((task) => (
      task.trashedAt === null
      && task.lifecycle === 'cancelled'
      && matchesFilters(task, { ...filters, lifecycle: 'cancelled' })
    ));
  }

  async search(filters = {}) {
    const tasks = await this.#tasks();
    const text = (filters.text ?? filters.query ?? '').trim().toLocaleLowerCase();
    return tasks.filter((task) => {
      if (task.trashedAt !== null) return false;
      if (!matchesFilters(task, filters)) return false;
      if (text.length === 0) return true;
      const haystack = `${task.title ?? ''}\n${task.description ?? ''}`.toLocaleLowerCase();
      return haystack.includes(text);
    });
  }
}
