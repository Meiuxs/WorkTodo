import { assertLocalDate, assertTimeRange } from './dates.js';
import { TransitionError, ValidationError } from './errors.js';

const LIFECYCLES = new Set(['todo', 'in_progress', 'completed', 'cancelled']);
const PRIORITIES = new Set(['none', 'low', 'medium', 'high']);
const ACTIONS = new Set(['START', 'COMPLETE', 'CANCEL', 'RESTORE', 'TRASH', 'UNTRASH', 'RESCHEDULE', 'POSTPONE']);

function assertIdentifier(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${fieldName} 不能为空`);
  }
}

function normalizeTitle(title) {
  if (typeof title !== 'string') {
    throw new ValidationError('title 必须是字符串');
  }

  const normalized = title.trim();
  if (normalized.length === 0 || normalized.length > 200) {
    throw new ValidationError('title 必须为 1 到 200 个字符');
  }
  return normalized;
}

function assertTaskDate(date, fieldName) {
  if (date !== null) {
    assertLocalDate(date, fieldName);
  }
}

function assertCategoryId(categoryId) {
  if (categoryId !== null && typeof categoryId !== 'string') {
    throw new ValidationError('categoryId 必须是字符串或 null');
  }
}

function assertActive(task, action) {
  if (task.trashedAt !== null || ['completed', 'cancelled'].includes(task.lifecycle)) {
    throw new TransitionError(`${action} 不能用于当前任务状态`);
  }
}

export function isInboxTask(task) {
  return task.scheduledDate === null;
}

export function validateTask(task) {
  if (task === null || typeof task !== 'object' || Array.isArray(task)) {
    throw new ValidationError('task 必须是对象');
  }

  assertIdentifier(task.id, 'id');
  normalizeTitle(task.title);
  if (!PRIORITIES.has(task.priority)) {
    throw new ValidationError('priority 无效');
  }
  assertCategoryId(task.categoryId);
  if (!LIFECYCLES.has(task.lifecycle)) {
    throw new ValidationError('lifecycle 无效');
  }
  if (!Number.isInteger(task.revision) || task.revision < 0) {
    throw new ValidationError('revision 必须是非负整数');
  }

  assertTaskDate(task.scheduledDate, 'scheduledDate');
  assertTaskDate(task.firstScheduledDate, 'firstScheduledDate');
  assertTimeRange(task.startTime, task.dueTime);
  if (isInboxTask(task) && (task.startTime !== null || task.dueTime !== null)) {
    throw new ValidationError('收集箱任务不能携带时间字段');
  }
  if (task.firstScheduledDate !== null && task.scheduledDate === null) {
    throw new ValidationError('firstScheduledDate 需要对应已安排任务');
  }
  if (task.lifecycle === 'completed' && task.completedAt === null) {
    throw new ValidationError('已完成任务必须有 completedAt');
  }
  if (task.lifecycle !== 'completed' && task.completedAt !== null) {
    throw new ValidationError('未完成任务不能有 completedAt');
  }
  if (task.trashedAt !== null && typeof task.trashedAt !== 'string') {
    throw new ValidationError('trashedAt 必须是字符串或 null');
  }
  return true;
}

export function createTask(input, now, id) {
  const source = input ?? {};
  const scheduledDate = source.scheduledDate ?? null;
  const startTime = source.startTime ?? null;
  const dueTime = source.dueTime ?? null;
  const task = {
    id,
    title: normalizeTitle(source.title),
    priority: source.priority ?? 'none',
    categoryId: source.categoryId ?? null,
    scheduledDate,
    firstScheduledDate: scheduledDate,
    startTime,
    dueTime,
    lifecycle: 'todo',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    trashedAt: null,
  };
  validateTask(task);
  return task;
}

export function transitionTask(task, action, now) {
  validateTask(task);
  if (action === null || typeof action !== 'object' || !ACTIONS.has(action.type)) {
    throw new TransitionError('不支持的任务操作');
  }

  const next = { ...task, updatedAt: now, revision: task.revision + 1 };
  switch (action.type) {
    case 'START':
      assertActive(task, action.type);
      if (task.lifecycle !== 'todo') throw new TransitionError('START 只能用于 todo 任务');
      next.lifecycle = 'in_progress';
      break;
    case 'COMPLETE':
      assertActive(task, action.type);
      next.lifecycle = 'completed';
      next.completedAt = now;
      break;
    case 'CANCEL':
      assertActive(task, action.type);
      next.lifecycle = 'cancelled';
      break;
    case 'RESTORE':
      if (!['completed', 'cancelled'].includes(task.lifecycle)) {
        throw new TransitionError('RESTORE 只能用于已完成或已取消任务');
      }
      next.lifecycle = 'todo';
      next.completedAt = null;
      break;
    case 'TRASH':
      if (task.trashedAt !== null) throw new TransitionError('任务已在回收站');
      next.trashedAt = now;
      break;
    case 'UNTRASH':
      if (task.trashedAt === null) throw new TransitionError('任务不在回收站');
      next.trashedAt = null;
      break;
    case 'RESCHEDULE':
      assertActive(task, action.type);
      assertLocalDate(action.date, 'date');
      next.scheduledDate = action.date;
      if (next.firstScheduledDate === null) next.firstScheduledDate = action.date;
      break;
    case 'POSTPONE':
      assertActive(task, action.type);
      assertLocalDate(action.date, 'date');
      if (task.scheduledDate === null || action.date <= task.scheduledDate) {
        throw new ValidationError('POSTPONE 必须安排到当前日期之后');
      }
      next.scheduledDate = action.date;
      break;
    default:
      throw new TransitionError('不支持的任务操作');
  }

  validateTask(next);
  return next;
}
