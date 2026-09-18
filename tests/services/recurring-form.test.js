import assert from 'node:assert/strict';
import test from 'node:test';
import { readRecurringForm } from '../../src/dashboard/recurring-form.js';

function form(values) {
  return {
    elements: {
      namedItem(name) {
        const value = values[name];
        return typeof value === 'object' ? value : { value: value ?? '', checked: Boolean(value) };
      },
    },
  };
}

test('未启用重复任务时不生成重复模板输入', () => {
  assert.equal(readRecurringForm(form({ recurring: false })), null);
});

test('启用重复任务时生成可交给重复服务的规则', () => {
  assert.deepEqual(readRecurringForm(form({
    recurring: true,
    recurrenceFrequency: 'weekly',
    recurrenceInterval: '2',
  })), {
    recurrence: { frequency: 'weekly', interval: 2 },
  });
});
