import assert from 'node:assert/strict';
import test from 'node:test';

import { TaskService } from '../../src/services/task-service.js';
import { InMemoryTaskRepository } from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';
const BASE_TASK = {
  id: 't1',
  title: '报价',
  priority: 'none',
  categoryId: 'old',
  scheduledDate: '2026-09-17',
  firstScheduledDate: '2026-09-17',
  startTime: null,
  dueTime: null,
  lifecycle: 'todo',
  revision: 0,
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
  trashedAt: null,
};

function createService({ tasks = [BASE_TASK], categories = [{ id: 'old', name: '旧分类' }] } = {}) {
  const repo = new InMemoryTaskRepository(tasks, categories);
  let nextId = 1;
  const service = new TaskService(repo, {
    now: () => NOW,
    generateId: () => `id-${nextId++}`,
  });
  return { repo, service };
}

test('延期写入 POSTPONE 事件且不改写首次计划日期', async () => {
  const { service } = createService();
  const result = await service.postpone('t1', '2026-09-20', 0);
  assert.equal(result.task.firstScheduledDate, '2026-09-17');
  assert.deepEqual(result.event.detail, { fromDate: '2026-09-17', toDate: '2026-09-20' });
  assert.equal(result.event.type, 'POSTPONE');
});

test('删除分类迁移任务但不删除任务', async () => {
  const { repo, service } = createService({
    categories: [{ id: 'old', name: '旧分类' }, { id: 'new', name: '新分类' }],
  });
  await service.deleteCategory('old', 'new');
  assert.equal((await repo.get('t1')).categoryId, 'new');
  assert.ok(await repo.get('t1'));
});

test('创建、编辑和开始任务分别写入稳定事件', async () => {
  const { repo, service } = createService({ tasks: [] });
  const created = await service.create({ title: '  新任务  ', categoryId: 'old' });
  assert.equal(created.task.title, '新任务');
  assert.equal(created.task.categoryId, 'old');
  assert.equal(created.event.type, 'CREATE');

  const edited = await service.edit(created.task.id, { title: '已编辑', priority: 'high' }, 0);
  assert.equal(edited.task.title, '已编辑');
  assert.equal(edited.task.priority, 'high');
  assert.equal(edited.event.type, 'EDIT');

  const started = await service.start(created.task.id, 1);
  assert.equal(started.task.lifecycle, 'in_progress');
  assert.equal(started.event.type, 'START');
  assert.equal((await repo.get(created.task.id)).revision, 2);
});

test('完成、恢复、取消、回收与还原使用领域状态迁移并保留 revision 冲突', async () => {
  const { service } = createService();
  const completed = await service.complete('t1', 0);
  assert.equal(completed.task.completedAt, NOW);
  assert.equal(completed.event.type, 'COMPLETE');

  const restored = await service.restore('t1', 1);
  assert.equal(restored.task.lifecycle, 'todo');
  assert.equal(restored.task.completedAt, null);
  assert.equal(restored.event.type, 'RESTORE');

  const cancelled = await service.cancel('t1', 2);
  assert.equal(cancelled.task.lifecycle, 'cancelled');
  assert.equal(cancelled.task.cancelledAt, NOW);
  await assert.rejects(() => service.trash('t1', 2), /其他编辑更新/);

  const trashed = await service.trash('t1', 3);
  assert.equal(trashed.task.trashedAt, NOW);
  assert.equal(trashed.event.type, 'TRASH');
  const untrashed = await service.untrash('t1', 4);
  assert.equal(untrashed.task.trashedAt, null);
  assert.equal(untrashed.event.type, 'UNTRASH');
});

test('重新安排使用 RESCHEDULE 事件并保留首次计划日期', async () => {
  const { service } = createService();
  const result = await service.reschedule('t1', '2026-09-16', 0);
  assert.equal(result.task.scheduledDate, '2026-09-16');
  assert.equal(result.task.firstScheduledDate, '2026-09-17');
  assert.equal(result.event.type, 'RESCHEDULE');
  assert.deepEqual(result.event.detail, { fromDate: '2026-09-17', toDate: '2026-09-16' });
});

test('编辑计划日期经由 RESCHEDULE 领域规则安排收集箱任务', async () => {
  const inbox = { ...BASE_TASK, scheduledDate: null, firstScheduledDate: null, categoryId: null };
  const { service } = createService({ tasks: [inbox], categories: [] });
  const result = await service.edit('t1', { scheduledDate: '2026-09-18' }, 0);
  assert.equal(result.task.scheduledDate, '2026-09-18');
  assert.equal(result.task.firstScheduledDate, '2026-09-18');
  assert.equal(result.event.type, 'RESCHEDULE');
});

test('复制创建新的 todo 任务并清理结束与回收时间', async () => {
  const source = {
    ...BASE_TASK,
    lifecycle: 'completed',
    completedAt: NOW,
    cancelledAt: NOW,
    trashedAt: NOW,
  };
  const { repo, service } = createService({ tasks: [source] });
  const copied = await service.copy('t1');
  assert.equal(copied.task.id, 'id-1');
  assert.equal(copied.task.lifecycle, 'todo');
  assert.equal(copied.task.completedAt, null);
  assert.equal(copied.task.cancelledAt, null);
  assert.equal(copied.task.trashedAt, null);
  assert.equal(copied.event.type, 'COPY');
  assert.ok(await repo.get('t1'));
});

test('分类可创建和改名，删除时可明确迁移至未分类', async () => {
  const { repo, service } = createService();
  const created = await service.createCategory('  待跟进  ');
  assert.deepEqual(created, { id: 'id-1', name: '待跟进', createdAt: NOW, updatedAt: NOW });
  const renamed = await service.renameCategory(created.id, '客户');
  assert.equal(renamed.name, '客户');

  await service.deleteCategory('old', null);
  assert.equal((await repo.get('t1')).categoryId, null);
  assert.deepEqual(await repo.listCategories(), [renamed]);
});

test('删除分类必须显式指定目标，且目标分类必须存在', async () => {
  const { service } = createService();
  await assert.rejects(() => service.deleteCategory('old'), /明确指定/);
  await assert.rejects(() => service.deleteCategory('old', 'missing'), /不存在/);
  await assert.rejects(() => service.deleteCategory('old', 'old'), /另一分类/);
});
