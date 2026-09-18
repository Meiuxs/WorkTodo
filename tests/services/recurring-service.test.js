import assert from 'node:assert/strict';
import test from 'node:test';

import { RecurringService } from '../../src/services/recurring-service.js';
import { TaskService } from '../../src/services/task-service.js';
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
