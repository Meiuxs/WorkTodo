import assert from 'node:assert/strict';
import test from 'node:test';
import { NAV_GROUPS, getQuickAddFeedback, shouldShowSummaryEditor } from '../../src/shared/ux.js';

test('导航分组覆盖现有路由并把今天放在计划入口首位', () => {
  assert.deepEqual(NAV_GROUPS.map((group) => group.id), ['today', 'planning', 'tasks', 'review', 'system']);
  assert.deepEqual(NAV_GROUPS[0].routes, ['today']);
  assert.deepEqual(NAV_GROUPS.find((group) => group.id === 'planning').routes, ['tomorrow', 'week', 'month']);
  assert.deepEqual(NAV_GROUPS.find((group) => group.id === 'tasks').routes, ['inbox', 'resources', 'all', 'completed', 'trash']);
});

test('快速新增反馈明确告诉用户任务去了哪里', () => {
  assert.deepEqual(getQuickAddFeedback({ scheduledDate: null }), {
    message: '已添加到收集箱',
    nextAction: '打开工作台',
    undoAction: '撤销',
  });
  assert.deepEqual(getQuickAddFeedback({ scheduledDate: '2026-09-19' }), {
    message: '已安排到 9月19日',
    nextAction: '打开工作台',
    undoAction: '撤销',
  });
});

test('总结编辑区只有生成内容后才显示', () => {
  assert.equal(shouldShowSummaryEditor(''), false);
  assert.equal(shouldShowSummaryEditor('  '), false);
  assert.equal(shouldShowSummaryEditor('本周完成 2 项'), true);
});
