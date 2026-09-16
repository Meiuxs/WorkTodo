import { ValidationError } from './errors.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function toLocalDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new ValidationError('date 必须是有效的 Date');
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function assertTimeRange(startTime, dueTime) {
  if (startTime === null && dueTime === null) {
    return;
  }

  if (!TIME_PATTERN.test(startTime ?? '') || !TIME_PATTERN.test(dueTime ?? '')) {
    throw new ValidationError('startTime 和 dueTime 必须是成对的 HH:MM 时间');
  }

  if (startTime >= dueTime) {
    throw new ValidationError('dueTime 必须晚于 startTime');
  }
}

export function isOverdueTask(task, today) {
  return task.trashedAt === null
    && !['completed', 'cancelled'].includes(task.lifecycle)
    && task.scheduledDate !== null
    && task.scheduledDate < today;
}

export function assertLocalDate(value, fieldName = '日期') {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new ValidationError(`${fieldName} 必须是 YYYY-MM-DD`);
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new ValidationError(`${fieldName} 不是有效日期`);
  }
}
