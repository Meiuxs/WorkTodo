import assert from 'node:assert/strict';
import test from 'node:test';

import { RecurringService } from '../../src/services/recurring-service.js';
import { TaskService } from '../../src/services/task-service.js';
import { SubtaskService } from '../../src/services/subtask-service.js';
import { ValidationError } from '../../src/domain/errors.js';
import { InMemoryRecurringTemplateRepository, InMemoryTaskRepository } from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';

function makeRecurringService({ taskRepository, templateRepository }) {
  let sequence = 0;
  const now = () => NOW;
  const generateId = () => `id-${++sequence}`;
  const taskService = new TaskService(taskRepository, { now, generateId });
  return new RecurringService({
    taskService,
    taskRepository,
    templateRepository,
    subtaskService: null,
    now,
    generateId,
  });
}

function makeRecurringFixture() {
  const taskRepository = new InMemoryTaskRepository();
  const templateRepository = new InMemoryRecurringTemplateRepository();
  return {
    taskRepository,
    templateRepository,
    service: makeRecurringService({ taskRepository, templateRepository }),
  };
}

test('创建重复模板时同时保存首个实例和模板', async () => {
  const taskRepository = new InMemoryTaskRepository();
  const templateRepository = new InMemoryRecurringTemplateRepository();
  const service = makeRecurringService({ taskRepository, templateRepository });

  const result = await service.createTemplate({
    title: '每周提交周报',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'weekly', interval: 1 },
  });

  assert.equal(result.template.active, true);
  assert.equal(result.task.seriesId, result.template.id);
  assert.equal(result.task.occurrenceKey, `${result.template.id}:2026-09-17`);
  assert.equal((await templateRepository.get(result.template.id)).title, '每周提交周报');
});

test('重复模板服务支持列表和按 id 查询', async () => {
  const taskRepository = new InMemoryTaskRepository();
  const templateRepository = new InMemoryRecurringTemplateRepository();
  const service = makeRecurringService({ taskRepository, templateRepository });

  const created = await service.createTemplate({
    title: '每日站会',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'daily', interval: 1 },
  });

  assert.deepEqual(await service.getTemplate(created.template.id), created.template);
  assert.deepEqual(await service.listTemplates(), [created.template]);
});

test('完成后生成下一实例且同一 occurrenceKey 不重复', async () => {
  const taskRepository = new InMemoryTaskRepository();
  const templateRepository = new InMemoryRecurringTemplateRepository();
  const service = makeRecurringService({ taskRepository, templateRepository });

  const created = await service.createTemplate({
    title: '每日复盘',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'daily', interval: 1 },
  });

  const completed = await service.complete(created.task.id, created.task.revision);
  const duplicate = await service.generateNext(created.template.id, '2026-09-17');
  const all = await taskRepository.list();

  assert.equal(completed.task.lifecycle, 'completed');
  assert.equal(completed.nextTask.scheduledDate, '2026-09-18');
  assert.equal(duplicate.id, completed.nextTask.id);
  assert.equal(all.filter((task) => task.seriesId === created.template.id).length, 2);
  assert.equal((await templateRepository.get(created.template.id)).active, true);
});

test('同一模板和日期重复生成只返回已有实例', async () => {
  const taskRepository = new InMemoryTaskRepository();
  const templateRepository = new InMemoryRecurringTemplateRepository();
  const service = makeRecurringService({ taskRepository, templateRepository });
  const created = await service.createTemplate({
    title: '幂等验证',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'daily', interval: 1 },
  });

  const first = await service.generateNext(created.template.id, '2026-09-17');
  const second = await service.generateNext(created.template.id, '2026-09-17');

  assert.equal(first.id, second.id);
});

test('未完成子任务时重复任务默认拒绝完成，force 才能放行', async () => {
  const taskRepository = new InMemoryTaskRepository();
  const templateRepository = new InMemoryRecurringTemplateRepository();
  let sequence = 0;
  const now = () => NOW;
  const generateId = () => `gate-${++sequence}`;
  const taskService = new TaskService(taskRepository, { now, generateId });
  const subtaskService = new SubtaskService(taskService, taskRepository);
  const service = new RecurringService({
    taskService,
    taskRepository,
    templateRepository,
    subtaskService,
    now,
    generateId,
  });
  const created = await service.createTemplate({
    title: '有门禁的重复任务',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'daily', interval: 1 },
  });
  await subtaskService.createSubtask(created.task.id, { title: '先完成子任务' });

  await assert.rejects(
    service.complete(created.task.id, created.task.revision),
    (error) => error instanceof ValidationError && error.message === '父任务仍有未完成子任务',
  );
  const completed = await service.complete(created.task.id, created.task.revision, { force: true });
  assert.equal(completed.task.lifecycle, 'completed');
  assert.equal(completed.nextTask.scheduledDate, '2026-09-18');
  assert.equal(completed.nextTaskCreated, true);
});

test('重复完成已完成实例不会生成第二个下一实例', async () => {
  const { service, taskRepository } = makeRecurringFixture();
  const created = await service.createTemplate({
    title: '重复完成保护',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'daily', interval: 1 },
  });
  const completed = await service.complete(created.task.id, created.task.revision);

  await assert.rejects(
    service.complete(completed.task.id, completed.task.revision),
  );
  const instances = await taskRepository.list();
  assert.equal(instances.filter((task) => task.seriesId === created.template.id).length, 2);
});

test('生成的下一实例可通过任务搜索找到', async () => {
  const { service, taskRepository } = makeRecurringFixture();
  const created = await service.createTemplate({
    title: '搜索可见的重复任务',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'daily', interval: 1 },
  });

  await service.generateNext(created.template.id, created.task.scheduledDate);

  assert.deepEqual(
    (await taskRepository.search('搜索可见')).map((task) => task.scheduledDate),
    ['2026-09-17', '2026-09-18'],
  );
});
