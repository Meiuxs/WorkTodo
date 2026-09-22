import { test, expect, openDashboard } from './fixtures.js';

test('桌面任务行悬停时直接露出星标与改期快捷操作', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('外露快捷操作任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();

  const row = page.locator('[data-task-id]').filter({ hasText: '外露快捷操作任务' });
  await row.hover();
  const quickActions = row.locator('.task__quick-actions');
  await expect(quickActions).toBeVisible();
  await expect(quickActions.getByRole('button', { name: '加星标', exact: true })).toBeVisible();
  await expect(quickActions.getByRole('button', { name: '安排明天', exact: true })).toBeVisible();
  await expect(row.locator('summary[aria-label^="更多任务操作"]')).toBeVisible();

  await quickActions.getByRole('button', { name: '加星标', exact: true }).click();
  await expect(page.getByText('已加星标')).toBeVisible();
  await expect(row.locator('.task__quick-actions button[data-action="set-starred"]')).toHaveAttribute('aria-label', '取消星标');
  const toastPlacement = await page.locator('#toast').evaluate((node) => ({
    right: getComputedStyle(node).right,
  }));
  expect(toastPlacement.right).not.toBe('auto');

  await quickActions.getByRole('button', { name: '安排明天', exact: true }).click();
  await expect(page.getByText('已安排到')).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: '明天', exact: true }).click();
  await expect(page.getByRole('button', { name: '外露快捷操作任务', exact: true })).toBeVisible();
});
