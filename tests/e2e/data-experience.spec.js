import { test, expect, openDashboard } from './fixtures.js';

async function seedTrashedTasks(page, tasks) {
  await page.evaluate(async (records) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('worktodo');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('tasks', 'readwrite');
      for (const task of records) transaction.objectStore('tasks').put(task);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, tasks);
}

function trashedTask({
  id,
  title,
  lifecycle,
  completedAt = null,
  cancelledAt = null,
  trashedAt,
}) {
  return {
    id,
    title,
    description: '',
    priority: 'none',
    starred: false,
    categoryId: null,
    parentId: null,
    tagIds: [],
    seriesId: null,
    occurrenceKey: null,
    scheduledDate: '2026-09-17',
    firstScheduledDate: '2026-09-17',
    startTime: null,
    dueTime: null,
    lifecycle,
    revision: 0,
    createdAt: '2026-09-17T08:00:00.000Z',
    updatedAt: '2026-09-17T08:00:00.000Z',
    completedAt,
    cancelledAt,
    trashedAt,
  };
}

test('回收站可以恢复任务，永久删除任务需要二次确认', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('待删除任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  const row = page.locator('[data-task-id]').filter({ has: page.getByRole('button', { name: '待删除任务' }) });
  await row.getByText('更多', { exact: true }).click();
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await page.locator('#confirm-dialog').getByRole('button', { name: '移入回收站' }).click();

  await page.getByRole('button', { name: '回收站' }).click();
  await expect(page.getByRole('button', { name: '待删除任务' })).toBeVisible();
  await row.getByText('更多', { exact: true }).click();
  await row.getByRole('button', { name: '永久删除' }).click();
  const confirmation = page.locator('#confirm-dialog');
  await expect(confirmation.getByRole('heading', { name: '永久删除任务？' })).toBeVisible();
  await confirmation.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('button', { name: '待删除任务' })).toBeVisible();
  await row.getByRole('button', { name: '永久删除' }).click();
  await confirmation.getByRole('button', { name: '永久删除' }).click();
  await expect(page.getByRole('button', { name: '待删除任务' })).toHaveCount(0);
});

test('回收站主复选框恢复四种状态并只清空 trashedAt', async ({ extension }) => {
  const page = await openDashboard(extension);
  const completedAt = '2026-09-17T09:00:00.000Z';
  const cancelledAt = '2026-09-17T09:30:00.000Z';
  const tasks = [
    trashedTask({
      id: 'trashed-todo',
      title: '回收站待办',
      lifecycle: 'todo',
      trashedAt: '2026-09-17T10:00:00.000Z',
    }),
    trashedTask({
      id: 'trashed-in-progress',
      title: '回收站进行中',
      lifecycle: 'in_progress',
      trashedAt: '2026-09-17T10:01:00.000Z',
    }),
    trashedTask({
      id: 'trashed-completed',
      title: '回收站已完成',
      lifecycle: 'completed',
      completedAt,
      trashedAt: '2026-09-17T10:02:00.000Z',
    }),
    trashedTask({
      id: 'trashed-cancelled',
      title: '回收站已取消',
      lifecycle: 'cancelled',
      cancelledAt,
      trashedAt: '2026-09-17T10:03:00.000Z',
    }),
  ];
  await seedTrashedTasks(page, tasks);

  await page.getByRole('button', { name: '回收站' }).click();
  for (const task of tasks) {
    const row = page.locator(`[data-task-id="${task.id}"]`);
    const checkbox = row.locator('.task__check');
    await expect(checkbox).toHaveAttribute('data-action', 'untrash');
    await expect(checkbox).toHaveAccessibleName('恢复任务');
  }

  for (const task of tasks) {
    const row = page.locator(`[data-task-id="${task.id}"]`);
    await row.locator('.task__check').click();
    await expect(row).toHaveCount(0);
  }
  await expect(page.getByText('回收站为空，删除的任务会在这里等待处理。')).toBeVisible();

  const restored = await page.evaluate(async (ids) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('worktodo');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise((resolve, reject) => {
      const transaction = database.transaction('tasks', 'readonly');
      const request = transaction.objectStore('tasks').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return records.filter((task) => ids.includes(task.id));
  }, tasks.map(({ id }) => id));

  expect(restored).toHaveLength(4);
  expect(restored.find(({ id }) => id === 'trashed-todo')).toMatchObject({
    lifecycle: 'todo',
    completedAt: null,
    cancelledAt: null,
    trashedAt: null,
  });
  expect(restored.find(({ id }) => id === 'trashed-in-progress')).toMatchObject({
    lifecycle: 'in_progress',
    completedAt: null,
    cancelledAt: null,
    trashedAt: null,
  });
  expect(restored.find(({ id }) => id === 'trashed-completed')).toMatchObject({
    lifecycle: 'completed',
    completedAt,
    cancelledAt: null,
    trashedAt: null,
  });
  expect(restored.find(({ id }) => id === 'trashed-cancelled')).toMatchObject({
    lifecycle: 'cancelled',
    completedAt: null,
    cancelledAt,
    trashedAt: null,
  });
});
