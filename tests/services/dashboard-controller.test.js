import assert from 'node:assert/strict';
import test from 'node:test';

import { DashboardController } from '../../src/dashboard/dashboard-controller.js';
import { createSettingsView, DataManagementController } from '../../src/dashboard/views/settings-view.js';
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

test('任务操作可在不打开编辑器时更新优先级', async () => {
  const calls = [];
  const controller = new DashboardController({
    views: { today: { async render() {} } },
    taskService: {
      async edit(id, changes, revision) {
        calls.push([id, changes, revision]);
        return { task: { id, revision: revision + 1 } };
      },
    },
  });

  await controller.handleTaskAction('set-priority', 't1', 2, 'high');

  assert.deepEqual(calls, [['t1', { priority: 'high' }, 2]]);
});

test('任务操作可在不打开编辑器时切换星标', async () => {
  const calls = [];
  const controller = new DashboardController({
    views: { today: { async render() {} } },
    taskService: { async edit(id, changes, revision) { calls.push([id, changes, revision]); return { task: { id } }; } },
  });

  await controller.handleTaskAction('set-starred', 't1', 1, true);

  assert.deepEqual(calls, [['t1', { starred: true }, 1]]);
});

test('完成重复任务通过重复服务生成下一实例', async () => {
  const calls = [];
  const controller = new DashboardController({
    views: { today: { async render() {} } },
    taskService: { async getTask() {} },
    recurringService: {
      async complete(taskId, revision, options) {
        calls.push([taskId, revision, options]);
        return { task: { id: taskId, revision: revision + 1 }, nextTask: { id: 'next' } };
      },
    },
    sendMessage: async (message) => calls.push(message),
  });

  const result = await controller.handleTaskAction('complete', 'repeat-1', 2, { force: true });
  assert.deepEqual(result.nextTask, { id: 'next' });
  assert.deepEqual(calls, [
    ['repeat-1', 2, { force: true }],
    { type: 'TASK_CHANGED', taskId: 'repeat-1' },
  ]);
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

test('恢复父任务时通过 SubtaskService 并传递确认结果', async () => {
  const calls = [];
  const controller = new DashboardController({
    views: { today: { async render() {} } },
    taskService: {},
    subtaskService: {
      async restoreParent(id, revision, options) {
        calls.push([id, revision, options]);
        return {
          task: { id, revision: revision + 1 },
          restoredChildren: [{ id: 'child-1', revision: 2 }],
        };
      },
    },
  });

  const result = await controller.handleTaskAction('restore', 'parent-1', 4, { force: true });

  assert.deepEqual(calls, [['parent-1', 4, { force: true }]]);
  assert.deepEqual(result.restoredChildren, [{ id: 'child-1', revision: 2 }]);
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

test('备份文件读取失败时显示通用错误且不保留文件内容', async () => {
  const controller = new DataManagementController({
    backupService: {
      async previewImport() {
        throw new Error('I/O failure');
      },
    },
  });

  await controller.selectFile({ text: async () => '{"schemaVersion":1}' });

  assert.equal(controller.state.kind, 'error');
  assert.equal(controller.state.text, null);
  assert.equal(controller.state.message, '备份文件无法读取，请选择有效的 WorkTodo JSON 文件。');
});

test('导入确认必须先完成预览，导入失败时保留错误状态', async () => {
  const controller = new DataManagementController({
    backupService: {
      async previewImport() {
        return { taskCount: 1, categoryCount: 0, eventCount: 0, resourceCount: 0, conflicts: [] };
      },
      async importBackup() {
        throw new ValidationError('备份版本不兼容');
      },
    },
  });

  await assert.rejects(controller.confirm('merge'), /当前没有可确认的导入预览/);
  await controller.selectFile({ text: async () => '{"schemaVersion":1}' });
  await controller.confirm('merge');

  assert.equal(controller.state.kind, 'error');
  assert.equal(controller.state.message, '备份版本不兼容');
  assert.equal(controller.state.text, null);
});

test('清除数据成功或失败都会通过统一状态返回结果', async () => {
  let clearCalls = 0;
  const success = new DataManagementController({
    backupService: {
      async clearAllData() { clearCalls += 1; },
    },
  });
  await success.clearAll();
  assert.equal(clearCalls, 1);
  assert.equal(success.state.kind, 'result');
  assert.match(success.state.message, /已清除全部本地数据/);

  const failure = new DataManagementController({
    backupService: {
      async clearAllData() { throw new Error('storage failure'); },
    },
  });
  await failure.clearAll();
  assert.equal(failure.state.kind, 'error');
  assert.match(failure.state.message, /原有数据保持不变/);
  failure.reset();
  assert.equal(failure.state.kind, 'idle');
  assert.equal(failure.state.canConfirm, false);
});

test('设置页首屏渲染分区、空列表和核心事件入口', async () => {
  const listeners = new Map();
  const elements = new Map();
  const element = (selector) => ({
    value: '',
    innerHTML: '',
    addEventListener(type, handler) {
      listeners.set(`${selector}:${type}`, handler);
    },
    querySelector() { return null; },
    focus() {},
  });
  for (const selector of [
    '[data-theme-setting]', '#data-state', '#export-backup', '#export-csv', '#import-file',
    '#clear-all-dialog', '#clear-all-data', '#create-category', '.category-list',
    '#category-message', '#delete-category-dialog',
  ]) {
    elements.set(selector, element(selector));
  }
  const root = {
    innerHTML: '',
    querySelector(selector) {
      return elements.get(selector) ?? null;
    },
  };

  const view = createSettingsView({
    root,
    taskService: { async listCategories() { return []; } },
    tagService: { async list() { return []; } },
    query: { async all() { return []; } },
    csvService: {},
    settingsRepository: {
      async getMetadata() { return {}; },
      async getSettings() { return { theme: 'system' }; },
    },
    backupService: {},
  });

  await view.render();

  assert.match(root.innerHTML, /外观/);
  assert.match(root.innerHTML, /数据管理/);
  assert.match(root.innerHTML, /还没有列表/);
  assert.match(root.innerHTML, /键盘快捷键/);
  assert.match(root.innerHTML, /危险区域/);
  assert.ok(listeners.has('[data-theme-setting]:change'));
  assert.ok(listeners.has('#export-backup:click'));
  assert.ok(listeners.has('#export-csv:click'));
  assert.ok(listeners.has('#import-file:change'));
  assert.ok(listeners.has('#clear-all-dialog:close'));
  assert.ok(listeners.has('#create-category:submit'));
  assert.ok(listeners.has('.category-list:click'));
});
