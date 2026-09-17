import { readFile } from 'node:fs/promises';
import { test, expect, openDashboard } from './fixtures.js';

test('导出包含版本信息，导入经过预览后可合并', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('备份任务');
  await dashboard.getByRole('button', { name: '添加', exact: true }).click();

  await dashboard.getByRole('button', { name: '设置' }).click();
  const downloadPromise = dashboard.waitForEvent('download');
  await dashboard.getByRole('button', { name: '导出 JSON 备份' }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  const backup = JSON.parse(await readFile(filePath, 'utf8'));
  expect(backup.schemaVersion).toBe(2);
  expect(backup.tags).toEqual([]);
  expect(backup.recurringTemplates).toEqual([]);
  expect(backup.tasks).toHaveLength(1);

  await dashboard.locator('#import-file').setInputFiles(filePath);
  await expect(dashboard.getByText(/任务 1 · 分类 0 · 事件 1/)).toBeVisible();
  await dashboard.getByRole('button', { name: '确认导入' }).click();
  await expect(dashboard.getByText(/导入完成：1 个任务/)).toBeVisible();
});
