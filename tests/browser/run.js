import { TaskRepository } from '../../src/data/task-repository.js';

const result = document.querySelector('#result');

async function run() {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const repository = new TaskRepository();
  const task = {
    id,
    title: 'IndexedDB smoke test',
    priority: 'none',
    categoryId: null,
    scheduledDate: null,
    firstScheduledDate: null,
    startTime: null,
    dueTime: null,
    lifecycle: 'todo',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    trashedAt: null,
  };
  await repository.create(task, {
    id: crypto.randomUUID(),
    taskId: id,
    type: 'TASK_CREATED',
    occurredAt: now,
    detail: { source: 'browser-smoke' },
  });
  const stored = await repository.get(id);
  if (stored?.id !== id) throw new Error(`读回任务不匹配：${JSON.stringify(stored)}`);
  result.textContent = 'PASS: IndexedDB create/get';
}

run().catch((error) => {
  result.textContent = `FAIL: ${error?.stack ?? error?.message ?? String(error)}`;
});
