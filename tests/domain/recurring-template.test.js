import assert from 'node:assert/strict';
import test from 'node:test';

import { ValidationError } from '../../src/domain/errors.js';
import {
  createOccurrenceKey,
  createRecurringTemplate,
  nextOccurrenceDate,
} from '../../src/domain/recurring-template.js';

const NOW = '2026-09-17T09:00:00.000Z';

test('重复规则校验并计算每天、工作日和月末日期', () => {
  const daily = createRecurringTemplate({
    title: '日报',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'daily', interval: 1 },
  }, NOW, 'template-1');
  assert.equal(nextOccurrenceDate(daily, '2026-09-17'), '2026-09-18');

  const weekdays = createRecurringTemplate({
    title: '周报',
    scheduledDate: '2026-09-18',
    recurrence: { frequency: 'weekdays', interval: 1 },
  }, NOW, 'template-2');
  assert.equal(nextOccurrenceDate(weekdays, '2026-09-18'), '2026-09-21');

  const monthly = createRecurringTemplate({
    title: '月度结算',
    scheduledDate: '2026-01-31',
    recurrence: { frequency: 'monthly', interval: 1 },
  }, NOW, 'template-3');
  assert.equal(nextOccurrenceDate(monthly, '2026-01-31'), '2026-02-28');
  assert.equal(createOccurrenceKey('template-3', '2026-02-28'), 'template-3:2026-02-28');
});

function template(recurrence, scheduledDate = '2026-09-17') {
  return createRecurringTemplate({ title: '边界测试', scheduledDate, recurrence }, NOW, 'boundary');
}

test('重复规则覆盖年、跨周工作日和自定义日周月', () => {
  const yearly = template({ frequency: 'yearly', interval: 1 }, '2024-02-29');
  assert.equal(nextOccurrenceDate(yearly, '2024-02-29'), '2025-02-28');

  const weekdays = template({ frequency: 'weekdays', interval: 1 }, '2026-09-20');
  assert.equal(nextOccurrenceDate(weekdays, '2026-09-20'), '2026-09-21');
  assert.equal(nextOccurrenceDate(weekdays, '2026-09-25'), '2026-09-28');

  assert.equal(nextOccurrenceDate(template({ frequency: 'custom', interval: 2, unit: 'day' }), '2026-09-17'), '2026-09-19');
  assert.equal(nextOccurrenceDate(template({ frequency: 'custom', interval: 2, unit: 'week' }), '2026-09-17'), '2026-10-01');
  assert.equal(nextOccurrenceDate(template({ frequency: 'custom', interval: 2, unit: 'month' }, '2026-01-31'), '2026-01-31'), '2026-03-31');
});

test('重复间隔和自定义单位校验边界值', () => {
  for (const interval of [0, 91, 1.5]) {
    assert.throws(() => template({ frequency: 'daily', interval }), ValidationError);
  }
  assert.throws(() => template({ frequency: 'custom', interval: 1 }), ValidationError);
  assert.throws(() => template({ frequency: 'custom', interval: 1, unit: 'year' }), ValidationError);
  assert.throws(() => template({ frequency: 'weekdays', interval: 2 }), ValidationError);
});
