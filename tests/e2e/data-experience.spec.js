import { readFile } from 'node:fs/promises';
import { test, expect, openDashboard } from './fixtures.js';

function rgbChannels(color) {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (channels?.length !== 3) throw new Error(`无法解析颜色：${color}`);
  return channels;
}

function relativeLuminance(color) {
  const channels = rgbChannels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

async function dashboardWithInitScript(extension, initScript) {
  const page = await extension.context.newPage();
  await page.addInitScript(initScript);
  await page.goto(`chrome-extension://${extension.extensionId}/src/dashboard/index.html`);
  return page;
}

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
  await row.getByRole('button', { name: '移入回收站', exact: true }).click();
  await page.locator('#confirm-dialog').getByRole('button', { name: '移入回收站' }).click();

  await page.getByRole('button', { name: '回收站', exact: true }).click();
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

  await page.getByRole('button', { name: '回收站', exact: true }).click();
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
  await expect(page.locator('.empty-state__title')).toHaveText('回收站是空的');

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

test('设置页可以下载 CSV 文件而不申请 downloads 权限', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByRole('button', { name: '设置' }).click();
  const permissions = await page.evaluate(() => chrome.runtime.getManifest().permissions ?? []);
  expect(permissions).not.toContain('downloads');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^worktodo-tasks-.*\.csv$/);

  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  const contents = await readFile(filePath);
  expect([...contents.subarray(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
  expect(contents.toString('utf8').slice(1).split('\r\n')[0]).toBe(
    '"标题","状态","优先级","列表","标签","计划日期","开始时间","截止时间","完成时间","创建时间"',
  );
});

test('深色模式选择在重新打开设置页后保持', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('主题').selectOption('dark');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('主题')).toHaveValue('dark');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
});

test('toast 撤销按钮在浅色和深色主题下都保持可读', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('主题').selectOption('dark');
  await page.getByRole('button', { name: '今天' }).click();
  await page.getByLabel('记录一个新事项').fill('检查主题对比度');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await expect(page.locator('#toast').getByRole('button', { name: '撤销' })).toBeVisible();

  await expect.poll(async () => {
    const colors = await page.locator('#toast').evaluate((toast) => ({
      background: getComputedStyle(toast).backgroundColor,
      action: getComputedStyle(toast.querySelector('button')).color,
    }));
    return contrastRatio(colors.action, colors.background);
  }).toBeGreaterThanOrEqual(4.5);

  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('主题').selectOption('light');
  await expect.poll(async () => {
    const colors = await page.locator('#toast').evaluate((toast) => ({
      background: getComputedStyle(toast).backgroundColor,
      action: getComputedStyle(toast.querySelector('button')).color,
    }));
    return contrastRatio(colors.action, colors.background);
  }).toBeGreaterThanOrEqual(4.5);
});

test('深色主题在应用外壳首次显示前完成解析', async ({ extension }) => {
  const setupPage = await openDashboard(extension);
  await setupPage.evaluate(() => chrome.storage.local.set({ settings: { theme: 'dark' } }));
  await setupPage.close();

  const page = await dashboardWithInitScript(extension, () => {
    const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = async (...args) => {
      if (args[0] === 'settings') {
        await new Promise((resolve) => {
          window.__releaseThemeRead = resolve;
        });
      }
      return originalGet(...args);
    };
  });

  // 先显式等待主题读取被挂起（挂起点已注册），再确认外壳在读取期间保持隐藏——
  // 这才是本条要守的不变式：外壳不能在主题解析完成前显示。
  await page.waitForFunction(() => typeof window.__releaseThemeRead === 'function');
  await expect(page.locator('.app')).toBeHidden();
  await page.evaluate(() => window.__releaseThemeRead());
  await expect(page.locator('.app')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
});

test('主题读取失败时回退 system 并恢复应用外壳', async ({ extension }) => {
  const page = await extension.context.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = (...args) => {
      if (args[0] === 'settings') return Promise.reject(new Error('模拟主题读取失败'));
      return originalGet(...args);
    };
  });
  await page.goto(`chrome-extension://${extension.extensionId}/src/dashboard/index.html`);

  await expect(page.locator('.app')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('模拟主题读取失败');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
});

test('非法主题设置在启动时归一为 system', async ({ extension }) => {
  const setupPage = await openDashboard(extension);
  await setupPage.evaluate(() => chrome.storage.local.set({ settings: { theme: 'sepia' } }));
  await setupPage.close();

  const page = await extension.context.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`chrome-extension://${extension.extensionId}/src/dashboard/index.html`);

  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('主题')).toHaveValue('system');
});

test('主题保存失败时不改变页面主题并恢复选择框', async ({ extension }) => {
  const setupPage = await openDashboard(extension);
  await setupPage.evaluate(() => chrome.storage.local.set({ settings: { theme: 'dark' } }));
  await setupPage.close();

  const page = await openDashboard(extension);
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('主题')).toHaveValue('dark');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.evaluate(() => {
    chrome.storage.local.set = async () => {
      throw new Error('模拟主题保存失败');
    };
  });

  await page.getByLabel('主题').selectOption('light');
  await expect(page.locator('#toast')).toContainText('模拟主题保存失败');
  await expect(page.getByLabel('主题')).toHaveValue('dark');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
});
