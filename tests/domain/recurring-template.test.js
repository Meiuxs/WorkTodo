import assert from 'node:assert/strict';
import test from 'node:test';

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
