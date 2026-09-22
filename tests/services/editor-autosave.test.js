import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorAutosave } from '../../src/dashboard/editor-autosave.js';

function createManualTimers() {
  const timers = [];
  let nextId = 0;
  return {
    set(callback, delay) {
      const timer = { id: ++nextId, callback, delay };
      timers.push(timer);
      return timer.id;
    },
    clear(id) {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    async fireNext() {
      const timer = timers.shift();
      assert.ok(timer, 'expected a scheduled timer');
      timer.callback();
      await Promise.resolve();
      await Promise.resolve();
      return timer.delay;
    },
    get size() {
      return timers.length;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

test('draft 变化后经过防抖只保存最后一次', async () => {
  const timers = createManualTimers();
  const saved = [];
  const autosave = createEditorAutosave({
    initial: { title: '旧标题' },
    delay: 500,
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear,
    save: async (draft) => {
      saved.push(draft);
      return draft;
    },
  });

  autosave.update({ title: '新标题 1' });
  autosave.update({ title: '新标题 2' });
  assert.equal(saved.length, 0);
  assert.equal(timers.size, 1);
  await timers.fireNext();

  assert.deepEqual(saved, [{ title: '新标题 2' }]);
  assert.equal(autosave.getState(), 'saved');
});

test('保存期间的新 draft 会在旧请求完成后继续保存', async () => {
  const firstResolve = deferred();
  const saved = [];
  const autosave = createEditorAutosave({
    initial: { title: 'A' },
    save: async (draft) => {
      saved.push(draft);
      if (saved.length === 1) return firstResolve.promise;
      return draft;
    },
    delay: 0,
  });

  autosave.update({ title: 'B' });
  const first = autosave.flush();
  autosave.update({ title: 'C' });
  firstResolve.resolve({ title: 'B' });
  await first;

  assert.deepEqual(saved, [{ title: 'B' }, { title: 'C' }]);
  assert.equal(autosave.getState(), 'saved');
});

test('flush 会立即提交待防抖的 draft', async () => {
  const timers = createManualTimers();
  const saved = [];
  const autosave = createEditorAutosave({
    initial: { title: 'A' },
    delay: 500,
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear,
    save: async (draft) => {
      saved.push(draft);
      return draft;
    },
  });

  autosave.update({ title: 'B' });
  await autosave.flush();

  assert.deepEqual(saved, [{ title: 'B' }]);
  assert.equal(timers.size, 0);
  assert.equal(autosave.getState(), 'saved');
});

test('外部变更到达时立即提交待防抖的 draft', async () => {
  const timers = createManualTimers();
  const saved = [];
  const autosave = createEditorAutosave({
    initial: { title: 'A' },
    delay: 500,
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear,
    save: async (draft) => {
      saved.push(draft);
      return draft;
    },
  });

  autosave.update({ title: 'B' });
  await autosave.flushOnExternalChange();

  assert.deepEqual(saved, [{ title: 'B' }]);
  assert.equal(timers.size, 0);
  assert.equal(autosave.getState(), 'saved');
});

test('保存失败保留 error 状态和 draft，冲突单独标记为 conflict', async () => {
  const conflict = Object.assign(new Error('revision 过期'), { name: 'ConflictError' });
  const states = [];
  const autosave = createEditorAutosave({
    initial: { title: 'A' },
    save: async () => { throw conflict; },
    onStateChange: ({ state }) => states.push(state),
    delay: 0,
  });

  autosave.update({ title: 'B' });
  await assert.rejects(autosave.flush(), conflict);
  assert.equal(autosave.getState(), 'conflict');
  assert.deepEqual(states, ['dirty', 'saving', 'conflict']);
});

test('reset 会取消未执行的定时器并回到 idle', async () => {
  const timers = createManualTimers();
  const saved = [];
  const autosave = createEditorAutosave({
    initial: { title: 'A' },
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear,
    save: async (draft) => {
      saved.push(draft);
      return draft;
    },
  });

  autosave.update({ title: 'B' });
  autosave.reset({ title: 'C' });

  assert.equal(timers.size, 0);
  assert.equal(autosave.getState(), 'idle');
  assert.deepEqual(saved, []);
  await autosave.flush();
  assert.deepEqual(saved, []);
});
