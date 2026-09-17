import { test, expect, openDashboard, openExtensionPage } from './fixtures.js';

const LEGACY_TASK = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '旧任务',
  description: '',
  starred: false,
  priority: 'none',
  categoryId: null,
  scheduledDate: '2026-09-17',
  firstScheduledDate: '2026-09-17',
  startTime: null,
  dueTime: null,
  lifecycle: 'todo',
  revision: 0,
  createdAt: '2026-09-17T08:30:00.000Z',
  updatedAt: '2026-09-17T08:30:00.000Z',
  completedAt: null,
  cancelledAt: null,
  trashedAt: null,
};
const LEGACY_TASKS = [
  LEGACY_TASK,
  {
    ...LEGACY_TASK,
    id: '22222222-2222-4222-8222-222222222222',
    title: '旧任务二',
  },
];

test('Chromium 中 v1 实库升级会物化旧任务关系字段', async ({ extension }) => {
  const runner = await openExtensionPage(extension.context, extension.extensionId, 'manifest.json');
  await runner.evaluate(async (legacyTasks) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('worktodo');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('测试数据库删除被阻塞'));
    });

    await new Promise((resolve, reject) => {
      const request = indexedDB.open('worktodo', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('tasks', { keyPath: 'id' });
        database.createObjectStore('categories', { keyPath: 'id' });
        database.createObjectStore('events', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('tasks', 'readwrite');
        for (const legacyTask of legacyTasks) {
          transaction.objectStore('tasks').put(legacyTask);
        }
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      };
    });
  }, LEGACY_TASKS);
  await runner.close();

  const dashboard = await openDashboard(extension);
  await expect(dashboard.getByRole('heading', { name: '今日工作' })).toBeVisible();
  const tasks = await dashboard.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('worktodo', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('tasks', 'readonly');
    const stored = await new Promise((resolve, reject) => {
      const request = transaction.objectStore('tasks').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return stored;
  });

  expect(tasks).toHaveLength(2);
  for (const task of tasks) {
    expect(task).toMatchObject({
      parentId: null,
      tagIds: [],
      seriesId: null,
      occurrenceKey: null,
    });
  }
});
