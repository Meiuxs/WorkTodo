import { assertLocalDate, addLocalDays, addLocalMonthsClamped } from './dates.js';
import { ValidationError } from './errors.js';
import { createTask } from './task.js';

const FREQUENCIES = new Set(['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom']);
const UNITS = new Set(['day', 'week', 'month']);

export function validateRecurringTemplate(template) {
  if (template === null || typeof template !== 'object' || Array.isArray(template)) {
    throw new ValidationError('重复模板必须是对象');
  }
  if (typeof template.id !== 'string' || template.id.length === 0) {
    throw new ValidationError('重复模板 id 不能为空');
  }
  if (typeof template.active !== 'boolean') {
    throw new ValidationError('active 必须是布尔值');
  }
  if (typeof template.title !== 'string' || template.title.trim().length === 0) {
    throw new ValidationError('重复模板标题不能为空');
  }
  assertLocalDate(template.scheduledDate, 'scheduledDate');

  const rule = template.recurrence;
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new ValidationError('recurrence 必须是对象');
  }
  if (!FREQUENCIES.has(rule.frequency)) {
    throw new ValidationError('recurrence.frequency 无效');
  }
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 90) {
    throw new ValidationError('recurrence.interval 必须是 1 到 90 的整数');
  }
  if (rule.frequency === 'weekdays' && rule.interval !== 1) {
    throw new ValidationError('weekdays 规则只支持每个工作日');
  }
  if (rule.frequency === 'custom' && !UNITS.has(rule.unit)) {
    throw new ValidationError('custom 规则必须指定 day、week 或 month');
  }
  return true;
}

export function createRecurringTemplate(input, now, id) {
  const source = input ?? {};
  const normalized = createTask(source, now, id);
  const template = {
    id,
    active: true,
    title: normalized.title,
    description: normalized.description,
    priority: normalized.priority,
    categoryId: normalized.categoryId,
    tagIds: normalized.tagIds,
    startTime: normalized.startTime,
    dueTime: normalized.dueTime,
    scheduledDate: normalized.scheduledDate,
    recurrence: { interval: 1, ...(source.recurrence ?? {}) },
    sourceTaskId: source.sourceTaskId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  validateRecurringTemplate(template);
  return template;
}

export function createOccurrenceKey(templateId, occurrenceDate) {
  if (typeof templateId !== 'string' || templateId.length === 0) {
    throw new ValidationError('templateId 不能为空');
  }
  assertLocalDate(occurrenceDate, 'occurrenceDate');
  return `${templateId}:${occurrenceDate}`;
}

export function nextOccurrenceDate(template, currentDate) {
  validateRecurringTemplate(template);
  assertLocalDate(currentDate, 'currentDate');
  const rule = template.recurrence;
  if (rule.frequency === 'daily') return addLocalDays(currentDate, rule.interval);
  if (rule.frequency === 'weekdays') {
    let candidate = addLocalDays(currentDate, 1);
    while ([0, 6].includes(new Date(`${candidate}T00:00:00Z`).getUTCDay())) {
      candidate = addLocalDays(candidate, 1);
    }
    return candidate;
  }
  if (rule.frequency === 'weekly') return addLocalDays(currentDate, 7 * rule.interval);
  if (rule.frequency === 'monthly') return addLocalMonthsClamped(currentDate, rule.interval);
  if (rule.frequency === 'yearly') return addLocalMonthsClamped(currentDate, 12 * rule.interval);
  if (rule.unit === 'day') return addLocalDays(currentDate, rule.interval);
  if (rule.unit === 'week') return addLocalDays(currentDate, 7 * rule.interval);
  return addLocalMonthsClamped(currentDate, rule.interval);
}
