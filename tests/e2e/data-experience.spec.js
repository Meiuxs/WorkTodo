import { test, expect, openDashboard } from './fixtures.js';

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
