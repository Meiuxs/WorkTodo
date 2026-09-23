import assert from 'node:assert/strict';
import test from 'node:test';

import {
  arrangeSubtasks,
  getScheduleOptions,
  renderTaskRow,
  taskMeta,
  taskPriorityLabel,
  taskTagLabel,
  taskTagSummary,
} from '../../src/dashboard/task-list.js';

// taskMeta 把 UTC 时间戳按系统本地时区渲染（08:30Z → 16:30 依赖东八区）；
// 固定为 Asia/Shanghai，使断言不随运行器默认时区（本地 UTC+8 / CI UTC）漂移。
process.env.TZ = 'Asia/Shanghai';

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

test('任务行渲染保留可访问状态、标签、资料和子任务信息并转义标题', () => {
  const html = renderTaskRow(task({
    id: 'parent-1',
    title: '<客户>跟进',
    revision: 4,
    priority: 'high',
    starred: true,
    tagIds: ['customer'],
    scheduledDate: '2026-09-16',
  }), {
    today: '2026-09-17',
    tags: [{ id: 'customer', name: '客户&合作' }],
    resourceCounts: new Map([['parent-1', 2]]),
    childrenByParent: new Map([['parent-1', [task({
      id: 'child-1',
      title: '发送报价',
      revision: 2,
      lifecycle: 'completed',
    })]]]),
  });

  assert.match(html, /role="listitem"/);
  assert.match(html, /task--overdue/);
  assert.match(html, /aria-checked="false"/);
  assert.match(html, /完成任务：&lt;客户&gt;跟进/);
  assert.match(html, /&lt;客户&gt;跟进/);
  assert.match(html, /#客户&amp;合作/);
  assert.match(html, /资料 2/);
  assert.match(html, /子任务 1\/1/);
  assert.match(html, /data-subtask-id="child-1"/);
});

test('回收站任务行提供恢复入口和永久删除动作，不渲染普通菜单', () => {
  const html = renderTaskRow(task({
    id: 'trashed-1',
    title: '待清理',
    revision: 7,
    trashedAt: '2026-09-17T00:00:00.000Z',
  }), { today: '2026-09-17' });

  assert.match(html, /data-action="untrash"/);
  assert.match(html, /aria-label="恢复任务：待清理"/);
  assert.match(html, /data-action="delete-permanently"/);
  assert.doesNotMatch(html, /class="task__more"/);
});

test('排列任务时只从顶层任务查询子任务并保留未随父任务出现的子任务', async () => {
  const calls = [];
  const parent = task({ id: 'parent-1', title: '父任务' });
  const child = task({ id: 'child-1', title: '子任务', parentId: 'parent-1' });
  const standaloneChild = task({ id: 'child-2', title: '独立子任务', parentId: 'other-parent' });
  const query = {
    async subtasksByParent(parentIds) {
      calls.push(parentIds);
      return new Map([['parent-1', [child]]]);
    },
  };

  const result = await arrangeSubtasks(query, [parent, child, standaloneChild]);

  assert.deepEqual(calls, [['parent-1']]);
  assert.deepEqual(result.topLevel.map(({ id }) => id), ['parent-1', 'child-2']);
  assert.deepEqual(result.childrenByParent.get('parent-1').map(({ id }) => id), ['child-1']);
});
