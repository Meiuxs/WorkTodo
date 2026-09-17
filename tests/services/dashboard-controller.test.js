import assert from 'node:assert/strict';
import test from 'node:test';

import { DashboardController } from '../../src/dashboard/dashboard-controller.js';
import { DataManagementController } from '../../src/dashboard/views/settings-view.js';
import { ValidationError } from '../../src/domain/errors.js';
import { runViewAction } from '../../src/shared/ui.js';

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

test('tomorrow 和 week 是正式识别路由', async () => {
  const rendered = [];
  const controller = new DashboardController({
    views: {
      today: { async render() { rendered.push('today'); } },
      tomorrow: { async render() { rendered.push('tomorrow'); } },
      week: { async render() { rendered.push('week'); } },
    },
  });

  assert.equal(await controller.navigate('tomorrow'), 'tomorrow');
  assert.equal(await controller.navigate('week'), 'week');
  assert.deepEqual(rendered, ['tomorrow', 'week']);
});

test('runViewAction 将未取消错误交给 onError', async () => {
  const errors = [];

  await runViewAction(async () => {
    throw new Error('visible failure');
  }, {
    signal: new AbortController().signal,
    onError: (error) => errors.push(error.message),
  });

  assert.deepEqual(errors, ['visible failure']);
});

test('runViewAction 吞掉取消后的迟到错误', async () => {
  const abortController = new AbortController();
  const errors = [];
  let rejectAction;
  const action = runViewAction(() => new Promise((resolve, reject) => {
    rejectAction = reject;
  }), {
    signal: abortController.signal,
    onError: (error) => errors.push(error.message),
  });

  await Promise.resolve();
  abortController.abort();
  rejectAction(new Error('late failure'));

  await assert.doesNotReject(action);
  assert.deepEqual(errors, []);
});

test('控制器对未取消的 render 错误保留 rejection 语义', async () => {
  const failure = new Error('render failed');
  const controller = new DashboardController({
    views: {
      today: {
        async render() {
          throw failure;
        },
      },
    },
  });

  await assert.rejects(controller.navigate('today'), failure);
});

test('新导航不会等待永不结束的旧 render', async () => {
  const rendered = [];
  let todaySignal;
  const todayView = {
    async render(signal) {
      todaySignal = signal;
      await new Promise(() => {});
    },
  };
  const inboxView = {
    async render(signal) {
      assert.equal(signal.aborted, false);
      rendered.push('inbox');
    },
  };
  const controller = new DashboardController({
    views: { today: todayView, inbox: inboxView },
  });

  const staleRender = controller.refresh();
  await Promise.resolve();
  const latestNavigation = controller.navigate('inbox');
  const outcome = await Promise.race([
    latestNavigation.then(() => 'completed'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 100)),
  ]);

  assert.equal(outcome, 'completed');
  assert.equal(todaySignal.aborted, true);
  assert.deepEqual(rendered, ['inbox']);
  await staleRender;
});

test('旧 render 释放后不会覆盖最新导航视图', async () => {
  const rendered = [];
  let releaseToday;
  let todaySignal;
  const todayView = {
    async render(signal) {
      todaySignal = signal;
      await new Promise((resolve) => { releaseToday = resolve; });
      if (!signal?.aborted) rendered.push('today');
    },
  };
  const inboxView = {
    async render(signal) {
      if (!signal?.aborted) rendered.push('inbox');
    },
  };
  const controller = new DashboardController({
    views: { today: todayView, inbox: inboxView },
  });

  const staleRender = controller.refresh();
  await Promise.resolve();
  const latestNavigation = controller.navigate('inbox');
  releaseToday();
  await Promise.all([staleRender, latestNavigation]);

  assert.equal(todaySignal?.aborted, true);
  assert.deepEqual(rendered, ['inbox']);
});

test('已取消 render 的 AbortError 不会向调用方传播', async () => {
  let releaseToday;
  const todayView = {
    async render() {
      await new Promise((resolve) => { releaseToday = resolve; });
      const error = new Error('render aborted');
      error.name = 'AbortError';
      throw error;
    },
  };
  const inboxView = { async render() {} };
  const controller = new DashboardController({
    views: { today: todayView, inbox: inboxView },
  });

  const staleRender = controller.refresh();
  await Promise.resolve();
  const latestNavigation = controller.navigate('inbox');
  releaseToday();
  await latestNavigation;

  await assert.doesNotReject(staleRender);
});

test('初始 render 完成后 signal 保持到下一次导航', async () => {
  const rendered = [];
  let releaseDelayedWrite;
  let viewSignal;
  const todayView = {
    async render(signal) {
      viewSignal = signal;
    },
  };
  const inboxView = {
    async render(signal) {
      if (!signal?.aborted) rendered.push('inbox');
    },
  };
  const controller = new DashboardController({
    views: { today: todayView, inbox: inboxView },
  });

  await controller.navigate('today');
  assert.equal(viewSignal.aborted, false);
  const delayedWrite = (async () => {
    await new Promise((resolve) => { releaseDelayedWrite = resolve; });
    if (!viewSignal.aborted) rendered.push('today-delayed');
  })();
  await Promise.resolve();

  await controller.navigate('inbox');
  assert.equal(viewSignal.aborted, true);
  releaseDelayedWrite();
  await delayedWrite;

  assert.deepEqual(rendered, ['inbox']);
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
