import assert from 'node:assert/strict';
import test from 'node:test';

import { getScheduleOptions, taskMeta, taskPriorityLabel, taskTagLabel, taskTagSummary } from '../../src/dashboard/task-list.js';

function task(overrides = {}) {
  return {
    lifecycle: 'todo',
    scheduledDate: '2026-09-17',
    startTime: null,
    dueTime: null,
    completedAt: null,
    cancelledAt: null,
    trashedAt: null,
    ...overrides,
  };
}

test('任务行状态与摘要互不重复，并保留进行中任务的计划时间', () => {
  assert.equal(taskMeta(task({ lifecycle: 'in_progress', startTime: '09:00', dueTime: '10:00' }), '2026-09-17'), '09:00–10:00');
  assert.match(taskMeta(task({ lifecycle: 'cancelled', cancelledAt: '2026-09-17T08:30:00.000Z' }), '2026-09-17'), /16:30$/);
  assert.equal(taskMeta(task({ lifecycle: 'cancelled' }), '2026-09-17'), '9月17日');
  assert.equal(taskMeta(task({ scheduledDate: '2026-09-16' }), '2026-09-17'), '原计划 9月16日');
});

test('已完成任务只显示完成时间，不重复“已完成”状态文案', () => {
  const meta = taskMeta(task({
    lifecycle: 'completed',
    completedAt: '2026-09-17T08:30:00.000Z',
  }), '2026-09-17');

  assert.match(meta, /16:30$/);
  assert.doesNotMatch(meta, /已完成|完成于/);
});

test('任务行标签使用文本表达而不是只靠颜色', () => {
  const tags = [{ id: 'customer', name: '客户' }, { id: 'quote', name: '报价' }];
  assert.equal(taskTagLabel({ tagIds: ['customer', 'missing'] }, tags), '#客户');
  assert.equal(taskTagLabel({ tagIds: [] }, tags), '');
});

test('任务行只展示前两个标签，其余折叠为 +N 并把完整清单留给 title', () => {
  const tags = [
    { id: 'customer', name: '客户' },
    { id: 'quote', name: '报价' },
    { id: 'week', name: '本周' },
  ];
  assert.deepEqual(taskTagSummary({ tagIds: ['customer', 'quote', 'week'] }, tags), {
    text: '#客户 #报价 +1',
    full: '#客户 #报价 #本周',
  });
  assert.deepEqual(taskTagSummary({ tagIds: ['customer'] }, tags), { text: '#客户', full: '#客户' });
  assert.equal(taskTagSummary({ tagIds: [] }, tags), null);
  // 引用了已删除的标签时不渲染空块，避免元信息里出现孤立的“ · ”。
  assert.equal(taskTagSummary({ tagIds: ['missing'] }, tags), null);
});

test('日期快捷操作覆盖计划常用日期', () => {
  assert.deepEqual(getScheduleOptions('2026-09-17').map((option) => option.label), [
    '今天', '明天', '后天', '下周一', '下周',
  ]);
  assert.deepEqual(getScheduleOptions('2026-09-17').map((option) => option.value), [
    '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-21', '2026-09-24',
  ]);
});

test('优先级始终有文字表达', () => {
  assert.equal(taskPriorityLabel('high'), '高优先级');
  assert.equal(taskPriorityLabel('medium'), '中优先级');
  assert.equal(taskPriorityLabel('low'), '低优先级');
  assert.equal(taskPriorityLabel('none'), '无优先级');
});
