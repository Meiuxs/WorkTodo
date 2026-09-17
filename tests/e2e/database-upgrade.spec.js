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
  {
    ...LEGACY_TASK,
    id: '22222222-2222-4222-8222-222222222222',
    title: '旧任务二',
  },
  LEGACY_TASK,
];

test('Chromium 中 v1 实库升级到 v3 会物化关系字段并按 ID 返回搜索结果', async ({ extension }) => {
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
  const upgraded = await dashboard.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('worktodo', 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['tasks', 'searchIndex'], 'readonly');
    const [stored, searchRecords] = await Promise.all([
      new Promise((resolve, reject) => {
        const request = transaction.objectStore('tasks').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
      new Promise((resolve, reject) => {
        const request = transaction.objectStore('searchIndex').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
    ]);
    const hasSearchIndex = database.objectStoreNames.contains('searchIndex');
    const searchStore = transaction.objectStore('searchIndex');
    const hasGramsIndex = searchStore.indexNames.contains('grams');
    const version = database.version;
    database.close();

    const { TaskRepository } = await import('../data/task-repository.js');
    const repository = new TaskRepository();
    const matches = await repository.search('旧任务');
    return {
      hasGramsIndex,
      hasSearchIndex,
      matches: matches.map(({ id }) => id),
      searchRecords,
      stored,
      version,
    };
  });

  expect(upgraded.version).toBe(3);
  expect(upgraded.hasSearchIndex).toBe(true);
  expect(upgraded.hasGramsIndex).toBe(true);
  expect(upgraded.stored).toHaveLength(2);
  expect(upgraded.searchRecords).toHaveLength(2);
  for (const record of upgraded.searchRecords) {
    expect(record).toEqual(expect.objectContaining({
      taskId: expect.any(String),
      grams: expect.arrayContaining(['旧', '任', '务', '旧任', '任务']),
    }));
  }
  for (const task of upgraded.stored) {
    expect(task).toMatchObject({
      parentId: null,
      tagIds: [],
      seriesId: null,
      occurrenceKey: null,
    });
  }
  expect(upgraded.matches).toEqual(LEGACY_TASKS.map(({ id }) => id).sort());
});
