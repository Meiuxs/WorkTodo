import assert from 'node:assert/strict';
import test from 'node:test';

import { SubtaskService } from '../../src/services/subtask-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { InMemoryTaskRepository } from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';

function taskFixture(overrides = {}) {
  return {
    id: 'parent-1',
    title: '发布 V1.1',
    description: '',
    priority: 'none',
    categoryId: null,
    parentId: null,
    tagIds: [],
    scheduledDate: '2026-09-17',
    firstScheduledDate: '2026-09-17',
    startTime: null,
    dueTime: null,
    seriesId: null,
    occurrenceKey: null,
    lifecycle: 'todo',
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    cancelledAt: null,
    trashedAt: null,
    ...overrides,
  };
}

function makeSubtaskService({ tasks = [taskFixture()] } = {}) {
  const repository = new InMemoryTaskRepository(tasks);
  let nextId = 1;
  const taskService = new TaskService(repository, {
    now: () => NOW,
    generateId: () => `id-${nextId++}`,
  });
  return {
    repository,
    taskService,
    service: new SubtaskService(taskService, repository),
  };
}

test('子任务只能挂在一级父任务下', async () => {
  const { service } = makeSubtaskService();
  const child = await service.createSubtask('parent-1', { title: '整理材料' });

  assert.equal(child.task.parentId, 'parent-1');
  assert.equal(child.task.lifecycle, 'todo');
  await assert.rejects(
    service.createSubtask(child.task.id, { title: '二级子任务' }),
    /子任务不能再创建子任务/,
  );
});

test('创建子任务保留父任务不存在的错误语义', async () => {
  const { service } = makeSubtaskService();

  await assert.rejects(
    service.createSubtask('missing-parent', { title: '整理材料' }),
    /任务 missing-parent 不存在/,
  );
});

test('undefined parentId 视为旧父任务而不是子任务', async () => {
  const legacyParent = taskFixture();
  delete legacyParent.parentId;
  const { service } = makeSubtaskService({ tasks: [legacyParent] });

  const child = await service.createSubtask('parent-1', { title: '整理材料' });

  assert.equal(child.task.parentId, 'parent-1');
});

test('列表只返回指定父任务的直接子任务', async () => {
  const secondParent = taskFixture({ id: 'parent-2', title: '另一个父任务' });
  const { service } = makeSubtaskService({ tasks: [taskFixture(), secondParent] });
  const first = await service.createSubtask('parent-1', { title: '整理材料' });
  await service.createSubtask('parent-2', { title: '发送通知' });

  assert.deepEqual(await service.list('parent-1'), [first.task]);
});

test('activeCount 忽略已完成、已取消、已回收和非本父任务的子任务', async () => {
  const parent = taskFixture();
  const { service } = makeSubtaskService({
    tasks: [
      parent,
      taskFixture({ id: 'active-todo', parentId: 'parent-1' }),
      taskFixture({ id: 'active-progress', parentId: 'parent-1', lifecycle: 'in_progress' }),
      taskFixture({
        id: 'completed',
        parentId: 'parent-1',
        lifecycle: 'completed',
        completedAt: NOW,
      }),
      taskFixture({
        id: 'cancelled',
        parentId: 'parent-1',
        lifecycle: 'cancelled',
        cancelledAt: NOW,
      }),
      taskFixture({ id: 'trashed', parentId: 'parent-1', trashedAt: NOW }),
      taskFixture({ id: 'other-parent', parentId: 'parent-2' }),
    ],
  });

  assert.equal(await service.activeCount('parent-1'), 2);
});

test('父任务存在未完成子任务时默认阻止完成，确认后连带完成子任务', async () => {
  const { repository, service } = makeSubtaskService();
  const child = await service.createSubtask('parent-1', { title: '整理材料' });

  await assert.rejects(service.completeParent('parent-1', 0), /仍有未完成子任务/);
  assert.equal((await repository.get('parent-1')).lifecycle, 'todo');
  assert.equal((await repository.get(child.task.id)).lifecycle, 'todo');

  const completed = await service.completeParent('parent-1', 0, { force: true });
  assert.equal(completed.task.lifecycle, 'completed');
  assert.equal(completed.event.type, 'COMPLETE');
  // 级联：未完成的子任务被一并完成，并回传供撤销逐个恢复。
  assert.deepEqual(completed.completedChildren.map((task) => task.id), [child.task.id]);
  assert.equal((await repository.get(child.task.id)).lifecycle, 'completed');
});

test('没有未完成子任务时父任务可直接完成', async () => {
  const { service } = makeSubtaskService({
    tasks: [
      taskFixture(),
      taskFixture({
        id: 'completed-child',
        parentId: 'parent-1',
        lifecycle: 'completed',
        completedAt: NOW,
      }),
    ],
  });

  const completed = await service.completeParent('parent-1', 0);

  assert.equal(completed.task.lifecycle, 'completed');
});

test('恢复父任务默认阻止，确认后级联恢复已完成子任务', async () => {
  const { repository, service } = makeSubtaskService({
    tasks: [
      taskFixture({ lifecycle: 'completed', completedAt: NOW }),
      taskFixture({ id: 'child-1', parentId: 'parent-1', lifecycle: 'completed', completedAt: NOW }),
      taskFixture({ id: 'child-2', parentId: 'parent-1', lifecycle: 'completed', completedAt: NOW }),
    ],
  });

  await assert.rejects(service.restoreParent('parent-1', 0), /有已完成子任务/);
  assert.equal((await repository.get('parent-1')).lifecycle, 'completed');
  assert.equal((await repository.get('child-1')).lifecycle, 'completed');

  const restored = await service.restoreParent('parent-1', 0, { force: true });
  assert.equal(restored.task.lifecycle, 'todo');
  assert.equal(restored.event.type, 'RESTORE');
  // 级联镜像：被完成方向级联带出的子任务一并回到待办。
  assert.deepEqual(restored.restoredChildren.map((task) => task.id), ['child-1', 'child-2']);
  assert.equal((await repository.get('child-1')).lifecycle, 'todo');
  assert.equal((await repository.get('child-2')).lifecycle, 'todo');
});

test('父任务 revision 过期时级联恢复在改子任务前失败', async () => {
  const { repository, service } = makeSubtaskService({
    tasks: [
      taskFixture({ lifecycle: 'completed', completedAt: NOW, revision: 1 }),
      taskFixture({ id: 'child-1', parentId: 'parent-1', lifecycle: 'completed', completedAt: NOW }),
    ],
  });

  await assert.rejects(service.restoreParent('parent-1', 0, { force: true }), { name: 'ConflictError' });
  assert.equal((await repository.get('child-1')).lifecycle, 'completed');
  assert.equal((await repository.get('child-1')).revision, 0);
});

test('没有已完成子任务时恢复父任务不要求确认', async () => {
  const { repository, service } = makeSubtaskService({
    tasks: [
      taskFixture({ lifecycle: 'completed', completedAt: NOW }),
      taskFixture({ id: 'open-child', parentId: 'parent-1' }),
    ],
  });

  const restored = await service.restoreParent('parent-1', 0);

  assert.equal(restored.task.lifecycle, 'todo');
  assert.deepEqual(restored.restoredChildren, []);
  assert.equal((await repository.get('open-child')).lifecycle, 'todo');
});

test('恢复子任务自身不级联也不要求确认', async () => {
  const { repository, service } = makeSubtaskService({
    tasks: [
      taskFixture({ lifecycle: 'completed', completedAt: NOW }),
      taskFixture({ id: 'child-1', parentId: 'parent-1', lifecycle: 'completed', completedAt: NOW }),
      taskFixture({ id: 'child-2', parentId: 'parent-1', lifecycle: 'completed', completedAt: NOW }),
    ],
  });

  const restored = await service.restoreParent('child-1', 0);

  assert.equal(restored.task.lifecycle, 'todo');
  assert.deepEqual(restored.restoredChildren, []);
  assert.equal((await repository.get('child-2')).lifecycle, 'completed');
  assert.equal((await repository.get('parent-1')).lifecycle, 'completed');
});
