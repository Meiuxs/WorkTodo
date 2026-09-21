import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryRecurringTemplateRepository, InMemoryTaskRepository } from '../helpers/fakes.js';
import { PopupController } from '../../src/popup/popup-controller.js';
import { RecurringService } from '../../src/services/recurring-service.js';
import { SubtaskService } from '../../src/services/subtask-service.js';
import { TaskService } from '../../src/services/task-service.js';

test('Popup 完成重复任务后生成下一实例，与 Dashboard 保持一致', async () => {
  const taskRepository = new InMemoryTaskRepository();
  const templateRepository = new InMemoryRecurringTemplateRepository();
  let sequence = 0;
  const now = () => '2026-09-17T09:00:00.000Z';
  const taskService = new TaskService(taskRepository, { now, generateId: () => `task-${++sequence}` });
  const subtaskService = new SubtaskService(taskService, taskRepository);
  const recurringService = new RecurringService({
    taskService,
    taskRepository,
    templateRepository,
    subtaskService,
    now,
    generateId: () => `id-${++sequence}`,
  });
  const created = await recurringService.createTemplate({
    title: '每日复盘',
    scheduledDate: '2026-09-17',
    recurrence: { frequency: 'daily', interval: 1 },
  });
  const messages = [];
  const controller = new PopupController({
    taskService,
    subtaskService,
    recurringService,
    queryService: {},
    statisticsService: {},
    today: () => '2026-09-17',
    sendMessage: async (message) => messages.push(message),
  });

  const result = await controller.completeTask(created.task.id, created.task.revision);

  assert.equal(result.task.lifecycle, 'completed');
  assert.equal(result.nextTask.scheduledDate, '2026-09-18');
  assert.deepEqual(messages, [{ type: 'TASK_CHANGED', taskId: created.task.id }]);
  assert.equal(
    (await taskRepository.list()).filter((task) => task.seriesId === created.template.id).length,
    2,
  );
});
