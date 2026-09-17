import assert from 'node:assert/strict';
import test from 'node:test';

import { UndoController } from '../../src/dashboard/undo-controller.js';

test('撤销控制器只保留最近一次动作且只能执行一次', async () => {
  const calls = [];
  const controller = new UndoController({ timeout: 5000 });
  controller.offer({ message: '已完成 A', undo: async () => calls.push('A') });
  controller.offer({ message: '已完成 B', undo: async () => calls.push('B') });

  assert.equal(controller.pending.message, '已完成 B');
  assert.equal(await controller.undo(), true);
  assert.equal(await controller.undo(), false);
  assert.deepEqual(calls, ['B']);
  assert.equal(controller.pending, null);
});

test('超时后撤销动作失效并清理计时器', () => {
  let timeoutCallback;
  let clearedTimer;
  const timer = 17;
  const controller = new UndoController({
    timeout: 5000,
    setTimeoutFn: (callback, delay) => {
      assert.equal(delay, 5000);
      timeoutCallback = callback;
      return timer;
    },
    clearTimeoutFn: (value) => {
      clearedTimer = value;
    },
  });

  controller.offer({ message: '已取消任务', undo: async () => {} });
  assert.equal(controller.pending.message, '已取消任务');

  timeoutCallback();

  assert.equal(clearedTimer, timer);
  assert.equal(controller.pending, null);
});

test('显式关闭会取消计时器并清除待撤销动作', async () => {
  let clearedTimer;
  let undoCalled = false;
  const controller = new UndoController({
    timeout: 5000,
    setTimeoutFn: () => 23,
    clearTimeoutFn: (value) => {
      clearedTimer = value;
    },
  });

  controller.offer({
    message: '已移入回收站',
    undo: async () => {
      undoCalled = true;
    },
  });
  controller.dismiss();

  assert.equal(clearedTimer, 23);
  assert.equal(controller.pending, null);
  assert.equal(await controller.undo(), false);
  assert.equal(undoCalled, false);
});

test('替换动作会取消旧计时器而不是让旧动作超时', () => {
  const callbacks = [];
  const clearedTimers = [];
  const controller = new UndoController({
    timeout: 5000,
    setTimeoutFn: (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    clearTimeoutFn: (timer) => {
      clearedTimers.push(timer);
    },
  });

  controller.offer({ message: '动作 A', undo: async () => {} });
  controller.offer({ message: '动作 B', undo: async () => {} });

  assert.deepEqual(clearedTimers, [1]);
  assert.equal(controller.pending.message, '动作 B');
});

test('默认计时器使用全局对象作为接收者', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let clearedTimer;
  globalThis.setTimeout = function (callback, delay) {
    assert.equal(this, globalThis);
    assert.equal(delay, 5000);
    return 31;
  };
  globalThis.clearTimeout = function (timer) {
    assert.equal(this, globalThis);
    clearedTimer = timer;
  };

  try {
    const controller = new UndoController({ timeout: 5000 });
    controller.offer({ message: '已完成任务', undo: async () => {} });
    controller.dismiss();

    assert.equal(clearedTimer, 31);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
