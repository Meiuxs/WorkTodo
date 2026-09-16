import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/domain/errors.js';
import { assertTimeRange, isOverdueTask, toLocalDate } from '../../src/domain/dates.js';

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
