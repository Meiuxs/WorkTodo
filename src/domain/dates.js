import { ValidationError } from './errors.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

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

  // 这两条会原样出现在任务编辑抽屉的错误行里，所以使用界面上的字段名，
  // 用户才知道该去改哪个输入框（内部字段名 startTime/dueTime 不出现在界面）。
  if (!TIME_PATTERN.test(startTime ?? '') || !TIME_PATTERN.test(dueTime ?? '')) {
    throw new ValidationError('开始时间和截止时间需要同时填写');
  }

  if (startTime >= dueTime) {
    throw new ValidationError('截止时间必须晚于开始时间');
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

export function addLocalDays(date, days) {
  assertLocalDate(date);
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

export function addLocalMonthsClamped(date, months) {
  assertLocalDate(date);
  if (!Number.isInteger(months)) {
    throw new ValidationError('months 必须是整数');
  }
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

export function startOfWeek(date, weekStartsOn = 1) {
  assertLocalDate(date);
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const offset = (value.getUTCDay() - weekStartsOn + 7) % 7;
  return addLocalDays(date, -offset);
}

export function endOfWeek(date, weekStartsOn = 1) {
  return addLocalDays(startOfWeek(date, weekStartsOn), 6);
}

export function startOfMonth(date) {
  assertLocalDate(date);
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date) {
  assertLocalDate(date);
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function eachLocalDate(startDate, endDate) {
  assertLocalDate(startDate, 'startDate');
  assertLocalDate(endDate, 'endDate');
  const result = [];
  for (let current = startDate; current <= endDate; current = addLocalDays(current, 1)) {
    result.push(current);
  }
  return result;
}

/* 展示层统一走下面两个格式化函数。
   日期在界面上只允许一种写法（9月19日），ISO 形式只保留在数据和导出里，
   否则同一屏会同时出现 2026-09-19 与 9月19日 两种格式。 */

export function formatLocalDay(date) {
  const [, month, day] = date.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

export function weekdayLabel(date) {
  const [year, month, day] = date.split('-').map(Number);
  return WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()];
}

export function formatLocalDayWithWeekday(date) {
  return `${formatLocalDay(date)} ${weekdayLabel(date)}`;
}
