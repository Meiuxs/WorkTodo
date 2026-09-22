import { assertLocalDate, assertTimeRange } from './dates.js';
import { TransitionError, ValidationError } from './errors.js';

const LIFECYCLES = new Set(['todo', 'in_progress', 'completed', 'cancelled']);
// 有序数组：循环切换优先级（行内 P 键）依赖这个顺序，Set 只用于校验。
const PRIORITY_ORDER = ['none', 'low', 'medium', 'high'];
const PRIORITIES = new Set(PRIORITY_ORDER);
const ACTIONS = new Set(['START', 'COMPLETE', 'CANCEL', 'RESTORE', 'TRASH', 'UNTRASH', 'RESCHEDULE', 'POSTPONE']);

export function nextPriority(priority) {
  const index = PRIORITY_ORDER.indexOf(priority);
  // 未知档位（脏数据）视为“无”，从循环头部重新进入，避免索引 -1 算出非法结果。
  return PRIORITY_ORDER[((index === -1 ? 0 : index) + 1) % PRIORITY_ORDER.length];
}

function assertIdentifier(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${fieldName} 不能为空`);
  }
}

/* 校验文案会出现在编辑抽屉、快速记录和子任务输入框下方，因此一律用界面上的字段名。
   空值与超长分开报：前者要用户补内容，后者要用户删到 200 字以内。 */
function normalizeTitle(title) {
  if (typeof title !== 'string') {
    throw new ValidationError('任务名称必须是文本');
  }

  const normalized = title.trim();
  if (normalized.length === 0) {
    throw new ValidationError('任务名称不能为空');
  }
  if (normalized.length > 200) {
    throw new ValidationError('任务名称不能超过 200 个字符');
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

function assertNullableIdentifier(value, fieldName) {
  if (value !== null) assertIdentifier(value, fieldName);
}

function assertNullableIsoTimestamp(value, fieldName) {
  if (value !== null && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) {
    throw new ValidationError(`${fieldName} 必须是有效的 ISO 时间字符串或 null`);
  }
}

function normalizeTagIds(tagIds) {
  if (tagIds === undefined) return [];
  if (!Array.isArray(tagIds)) throw new ValidationError('tagIds 必须是数组');
  const normalized = [];
  for (let index = 0; index < tagIds.length; index += 1) {
    const id = tagIds[index];
    assertIdentifier(id, 'tagId');
    normalized.push(id);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new ValidationError('tagIds 不能重复');
  }
  return normalized;
}

function normalizeDescription(description) {
  if (description === undefined || description === null) return '';
  if (typeof description !== 'string') {
    throw new ValidationError('描述必须是文本');
  }
  const normalized = description.trim();
  if (normalized.length > 10_000) {
    throw new ValidationError('描述不能超过 10000 个字符');
  }
  return normalized;
}

function assertActive(task, action) {
  if (task.trashedAt !== null || ['completed', 'cancelled'].includes(task.lifecycle)) {
    throw new TransitionError(`${action} 不能用于当前任务状态`);
  }
}

export function isInboxTask(task) {
  return task.scheduledDate === null;
}

// 子任务：带 parentId 的任务。顶层列表只展示 parentId 为空的任务，子任务靠父行内联呈现。
export function isSubtask(task) {
  return task.parentId !== null && task.parentId !== undefined;
}

export function validateTask(task) {
  if (task === null || typeof task !== 'object' || Array.isArray(task)) {
    throw new ValidationError('task 必须是对象');
  }

  assertIdentifier(task.id, 'id');
  normalizeTitle(task.title);
  if (task.description !== undefined) normalizeDescription(task.description);
  if (task.starred !== undefined && typeof task.starred !== 'boolean') {
    throw new ValidationError('starred 必须是布尔值');
  }
  if (!PRIORITIES.has(task.priority)) {
    throw new ValidationError('priority 无效');
  }
  assertCategoryId(task.categoryId);
  if (task.parentId !== undefined) assertNullableIdentifier(task.parentId, 'parentId');
  normalizeTagIds(task.tagIds);
  if (task.seriesId !== undefined) assertNullableIdentifier(task.seriesId, 'seriesId');
  if (task.occurrenceKey !== undefined) {
    assertNullableIdentifier(task.occurrenceKey, 'occurrenceKey');
  }
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
    throw new ValidationError('没有计划日期的任务不能填写时间，请先选择计划日期');
  }
  if (task.lifecycle === 'completed' && task.completedAt === null) {
    throw new ValidationError('已完成任务必须有 completedAt');
  }
  if (task.lifecycle !== 'completed' && task.completedAt !== null) {
    throw new ValidationError('未完成任务不能有 completedAt');
  }
  assertNullableIsoTimestamp(task.completedAt, 'completedAt');
  assertNullableIsoTimestamp(task.cancelledAt ?? null, 'cancelledAt');
  assertNullableIsoTimestamp(task.trashedAt, 'trashedAt');
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
    description: normalizeDescription(source.description),
    starred: source.starred ?? false,
    priority: source.priority ?? 'none',
    categoryId: source.categoryId ?? null,
    parentId: source.parentId ?? null,
    tagIds: normalizeTagIds(source.tagIds),
    seriesId: source.seriesId ?? null,
    occurrenceKey: source.occurrenceKey ?? null,
    scheduledDate,
    firstScheduledDate: scheduledDate,
    startTime,
    dueTime,
    lifecycle: 'todo',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    cancelledAt: null,
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
      next.cancelledAt = now;
      break;
    case 'RESTORE':
      if (!['completed', 'cancelled'].includes(task.lifecycle)) {
        throw new TransitionError('RESTORE 只能用于已完成或已取消任务');
      }
      next.lifecycle = 'todo';
      next.completedAt = null;
      next.cancelledAt = null;
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
      if (action.date !== null) assertLocalDate(action.date, 'date');
      next.scheduledDate = action.date;
      if (action.date === null) {
        next.startTime = null;
        next.dueTime = null;
      } else if (next.firstScheduledDate === null) {
        next.firstScheduledDate = action.date;
      }
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
