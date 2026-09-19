import assert from 'node:assert/strict';
import test from 'node:test';

import { PopupController } from '../../src/popup/popup-controller.js';
import { broadcastTaskChanged } from '../../src/background/service-worker.js';

test('quickCreate 只传标题时创建收集箱任务并广播', async () => {
  const calls = [];
  const messages = [];
  const controller = new PopupController({
    taskService: {
      async create(input) {
        calls.push({ input });
        return { task: { id: 'created-id' } };
      },
    },
    queryService: {},
    statisticsService: {},
    today: () => '2026-09-17',
    sendMessage: async (message) => messages.push(message),
  });

  await controller.quickCreate('联系客户', null);

  assert.equal(calls[0].input.title, '联系客户');
  assert.equal(calls[0].input.scheduledDate, null);
  assert.deepEqual(messages, [{ type: 'TASK_CHANGED', taskId: 'created-id' }]);
});

test('undoCreate 删除刚创建任务并广播变更', async () => {
  const calls = [];
  const messages = [];
  const controller = new PopupController({
    taskService: {
      async undoCreate(id, revision) {
        calls.push({ id, revision });
        return { task: { id, revision, trashedAt: null } };
      },
    },
    queryService: {},
    statisticsService: {},
    today: () => '2026-09-17',
    sendMessage: async (message) => messages.push(message),
  });

  await controller.undoCreate({ id: 'created-id', revision: 0 });

  assert.deepEqual(calls, [{ id: 'created-id', revision: 0 }]);
  assert.deepEqual(messages, [{ type: 'TASK_CHANGED', taskId: 'created-id' }]);
});

test('load 最多展示三个关注任务', async () => {
  const controller = new PopupController({
    taskService: {},
    queryService: {
      async today() {
        return [
          { id: 'a', scheduledDate: '2026-09-16', lifecycle: 'todo', trashedAt: null },
          { id: 'b', scheduledDate: '2026-09-17', lifecycle: 'todo', trashedAt: null },
          { id: 'c', scheduledDate: '2026-09-17', lifecycle: 'todo', trashedAt: null },
          { id: 'd', scheduledDate: '2026-09-17', lifecycle: 'todo', trashedAt: null },
        ];
      },
    },
    statisticsService: {
      async daily() {
        return { completedCount: 2, plannedCount: 5, completionRate: 0.4 };
      },
    },
    today: () => '2026-09-17',
    sendMessage: async () => {},
  });

  const state = await controller.load();

  assert.deepEqual(state.focusTasks.map((task) => task.id), ['a', 'b', 'c']);
  assert.deepEqual(state.summary, { completedCount: 2, plannedCount: 5, completionRate: 0.4 });
  assert.equal(state.overdueCount, 1);
});

test('load 保留逾期总数，供 Popup 明确提示未展示的逾期任务', async () => {
  const controller = new PopupController({
    taskService: {},
    queryService: {
      async today() {
        return [
          { id: 'a', scheduledDate: '2026-09-16', lifecycle: 'todo', trashedAt: null },
          { id: 'b', scheduledDate: '2026-09-15', lifecycle: 'todo', trashedAt: null },
          { id: 'c', scheduledDate: '2026-09-14', lifecycle: 'todo', trashedAt: null },
          { id: 'd', scheduledDate: '2026-09-13', lifecycle: 'todo', trashedAt: null },
        ];
      },
    },
    statisticsService: { async daily() { return { completedCount: 0, plannedCount: 4, completionRate: 0 }; } },
    today: () => '2026-09-17',
    sendMessage: async () => {},
  });

  const state = await controller.load();

  assert.equal(state.overdueCount, 4);
  assert.equal(state.focusTasks.length, 3);
});

test('broadcastTaskChanged 向所有扩展页面发送统一变更消息', async () => {
  const messages = [];

  await broadcastTaskChanged({ taskId: 't1' }, {
    sendMessage: async (message) => messages.push(message),
  });

  assert.deepEqual(messages, [{ type: 'TASK_CHANGED', taskId: 't1' }]);
});
