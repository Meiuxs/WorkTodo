import assert from 'node:assert/strict';
import test from 'node:test';

import { taskMeta } from '../../src/dashboard/task-list.js';

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
