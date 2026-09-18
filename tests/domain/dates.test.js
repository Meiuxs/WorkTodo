import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/domain/errors.js';
import {
  addLocalDays,
  addLocalMonthsClamped,
  assertTimeRange,
  eachLocalDate,
  endOfMonth,
  endOfWeek,
  isOverdueTask,
  startOfMonth,
  startOfWeek,
  toLocalDate,
} from '../../src/domain/dates.js';

test('toLocalDate 将 Date 转换为本地 YYYY-MM-DD 日期', () => {
  const date = new Date(2026, 8, 17, 0, 5, 0);
  assert.equal(toLocalDate(date), '2026-09-17');
});

test('时间范围接受成对且有序的 HH:MM 时间', () => {
  assert.doesNotThrow(() => assertTimeRange('09:00', '10:30'));
  assert.doesNotThrow(() => assertTimeRange(null, null));
  assert.throws(() => assertTimeRange('10:30', '09:00'), ValidationError);
  assert.throws(() => assertTimeRange('09:00', null), ValidationError);
  assert.throws(() => assertTimeRange('9:00', '10:00'), ValidationError);
});

test('逾期任务排除已完成、已取消、已删除和收集箱任务', () => {
  const due = { lifecycle: 'todo', scheduledDate: '2026-09-16', trashedAt: null };
  assert.equal(isOverdueTask(due, '2026-09-17'), true);
  assert.equal(isOverdueTask({ ...due, lifecycle: 'completed' }, '2026-09-17'), false);
  assert.equal(isOverdueTask({ ...due, lifecycle: 'cancelled' }, '2026-09-17'), false);
  assert.equal(isOverdueTask({ ...due, trashedAt: '2026-09-17T00:00:00.000Z' }, '2026-09-17'), false);
  assert.equal(isOverdueTask({ ...due, scheduledDate: null }, '2026-09-17'), false);
});

test('本地日期范围工具跨月跨年且周一作为默认周起点', () => {
  assert.equal(addLocalDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addLocalDays('2026-12-31', 1), '2027-01-01');
  assert.equal(startOfWeek('2026-09-17'), '2026-09-14');
  assert.equal(endOfWeek('2026-09-17'), '2026-09-20');
  assert.equal(startOfMonth('2026-09-17'), '2026-09-01');
  assert.equal(endOfMonth('2026-09-17'), '2026-09-30');
  assert.deepEqual(eachLocalDate('2026-09-28', '2026-10-02'), [
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
  ]);
});

test('月份偏移在目标月份天数不足时钳制到月末', () => {
  assert.equal(addLocalMonthsClamped('2026-01-31', 1), '2026-02-28');
  assert.equal(addLocalMonthsClamped('2024-01-31', 1), '2024-02-29');
  assert.equal(addLocalMonthsClamped('2026-12-15', 1), '2027-01-15');
});
