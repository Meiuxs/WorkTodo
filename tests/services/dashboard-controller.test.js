import assert from 'node:assert/strict';
import test from 'node:test';

import { DashboardController } from '../../src/dashboard/dashboard-controller.js';
import { DataManagementController } from '../../src/dashboard/views/settings-view.js';
import { ValidationError } from '../../src/domain/errors.js';

test('接到 TASK_CHANGED 后刷新当前视图', async () => {
  const view = { renderCount: 0, async render() { this.renderCount += 1; } };
  const controller = new DashboardController({ views: { today: view } });

  await controller.navigate('today');
  await controller.onMessage({ type: 'TASK_CHANGED', taskId: 't1' });

  assert.equal(view.renderCount, 2);
});

test('未知路由回退到 today', async () => {
  const view = { async render() {} };
  const controller = new DashboardController({ views: { today: view } });

  assert.equal(await controller.navigate('unknown'), 'today');
});

test('任务操作调用服务、广播并刷新当前视图', async () => {
  const view = { renderCount: 0, async render() { this.renderCount += 1; } };
  const calls = [];
  const messages = [];
  const controller = new DashboardController({
    views: { today: view },
    taskService: { async complete(id, revision) { calls.push([id, revision]); return { task: { id } }; } },
    sendMessage: async (message) => messages.push(message),
  });
  await controller.navigate('today');

  await controller.handleTaskAction('complete', 't1', 3);

  assert.deepEqual(calls, [['t1', 3]]);
  assert.deepEqual(messages, [{ type: 'TASK_CHANGED', taskId: 't1' }]);
  assert.equal(view.renderCount, 2);
});

test('完成父任务时通过 SubtaskService 并传递确认结果', async () => {
  const calls = [];
  const view = { async render() {} };
  const controller = new DashboardController({
    views: { today: view },
    taskService: {},
    subtaskService: {
      async completeParent(id, revision, options) {
        calls.push([id, revision, options]);
        return { task: { id, revision: revision + 1 } };
      },
    },
  });

  await controller.handleTaskAction('complete', 'parent-1', 4, { force: true });

  assert.deepEqual(calls, [['parent-1', 4, { force: true }]]);
});

test('导入验证失败停在 error 且不能确认', async () => {
  const controller = new DataManagementController({
    backupService: {
      async previewImport() {
        throw new ValidationError('备份内容不是合法 JSON');
      },
    },
  });

  await controller.selectFile({ text: async () => '{bad json' });

  assert.equal(controller.state.kind, 'error');
  assert.equal(controller.state.canConfirm, false);
  assert.match(controller.state.message, /合法 JSON/);
});

test('导入预览后允许选择合并或覆盖并报告结果', async () => {
  const calls = [];
  const controller = new DataManagementController({
    backupService: {
      async previewImport(text) {
        calls.push(['preview', text]);
        return { taskCount: 2, categoryCount: 1, eventCount: 3, conflicts: [{ id: 't1' }] };
      },
      async importBackup(text, mode) {
        calls.push(['import', text, mode]);
        return { taskCount: 2, categoryCount: 1, eventCount: 3, conflicts: [{ id: 't1' }] };
      },
    },
  });

  await controller.selectFile({ text: async () => '{"schemaVersion":1}' });
  assert.equal(controller.state.kind, 'preview');
  assert.equal(controller.state.canConfirm, true);
  assert.equal(controller.state.preview.taskCount, 2);

  await controller.confirm('merge');

  assert.deepEqual(calls, [
    ['preview', '{"schemaVersion":1}'],
    ['import', '{"schemaVersion":1}', 'merge'],
  ]);
  assert.equal(controller.state.kind, 'result');
  assert.equal(controller.state.canConfirm, false);
});
