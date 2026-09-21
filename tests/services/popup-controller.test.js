import assert from 'node:assert/strict';
import test from 'node:test';

import { PopupController } from '../../src/popup/popup-controller.js';
import { SubtaskService } from '../../src/services/subtask-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { broadcastTaskChanged } from '../../src/background/service-worker.js';
import { InMemoryTaskRepository } from '../helpers/fakes.js';

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

test('load 逐节限量展示关注任务，逾期不挤占今日配额', async () => {
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

  assert.deepEqual(state.focusTasks.map((task) => task.id), ['b', 'c', 'd']);
  assert.deepEqual(state.overdueTasks.map((task) => task.id), ['a']);
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
  // 逾期按自己的配额取前 3 条，不得挤占今日名额（今日 0 条时也不得被逾期填满）。
  assert.deepEqual(state.overdueTasks.map((task) => task.id), ['a', 'b', 'c']);
  assert.equal(state.focusTasks.length, 0);
});

test('completeTask 级联完成活动子任务并逐个广播，返回父与子供撤销', async () => {
  const fixture = (id, overrides) => ({
    id,
    title: `任务 ${id}`,
    description: '',
    priority: 'none',
    categoryId: null,
    tagIds: [],
    scheduledDate: '2026-09-17',
    firstScheduledDate: '2026-09-17',
    startTime: null,
    dueTime: null,
    seriesId: null,
    occurrenceKey: null,
    lifecycle: 'todo',
    revision: 0,
    createdAt: '2026-09-17T08:00:00.000Z',
    updatedAt: '2026-09-17T08:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    trashedAt: null,
    ...overrides,
  });
  const repository = new InMemoryTaskRepository([
    fixture('parent-1', { parentId: null }),
    fixture('child-1', { parentId: 'parent-1', scheduledDate: null, firstScheduledDate: null }),
  ]);
  const taskService = new TaskService(repository, { now: () => '2026-09-17T09:00:00.000Z' });
  const messages = [];
  const controller = new PopupController({
    taskService,
    subtaskService: new SubtaskService(taskService, repository),
    queryService: {},
    statisticsService: {},
    today: () => '2026-09-17',
    sendMessage: async (message) => messages.push(message),
  });

  const { task, completedChildren } = await controller.completeTask('parent-1', 0);

  assert.equal(task.lifecycle, 'completed');
  assert.equal(completedChildren.length, 1);
  assert.equal(completedChildren[0].id, 'child-1');
  assert.deepEqual(messages, [
    { type: 'TASK_CHANGED', taskId: 'parent-1' },
    { type: 'TASK_CHANGED', taskId: 'child-1' },
  ]);

  // 撤销覆盖父与子：与工作台同一口径。
  await controller.restoreTask(task.id, task.revision);
  await controller.restoreTasks(completedChildren);
  const restored = await repository.list({});
  assert.deepEqual(
    restored.map((item) => [item.id, item.lifecycle]),
    [['child-1', 'todo'], ['parent-1', 'todo']],
  );
});

test('restoreTask 用完成后的 revision 撤销完成并广播', async () => {
  const calls = [];
  const messages = [];
  const controller = new PopupController({
    taskService: {
      async restore(id, revision) {
        calls.push({ id, revision });
        return { task: { id, revision: revision + 1, lifecycle: 'todo' }, event: { id: 'e2' } };
      },
    },
    queryService: {},
    statisticsService: {},
    today: () => '2026-09-17',
    sendMessage: async (message) => messages.push(message),
  });

  const task = await controller.restoreTask('t1', 4);

  assert.deepEqual(calls, [{ id: 't1', revision: 4 }]);
  assert.equal(task.lifecycle, 'todo');
  assert.deepEqual(messages, [{ type: 'TASK_CHANGED', taskId: 't1' }]);
});

test('broadcastTaskChanged 向所有扩展页面发送统一变更消息', async () => {
  const messages = [];

  await broadcastTaskChanged({ taskId: 't1' }, {
    sendMessage: async (message) => messages.push(message),
  });

  assert.deepEqual(messages, [{ type: 'TASK_CHANGED', taskId: 't1' }]);
});
