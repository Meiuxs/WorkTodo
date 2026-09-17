import { test, expect, openDashboard } from './fixtures.js';

test('移动视口下快速新增和任务操作不产生横向溢出', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 390, height: 844 });

  await dashboard.getByLabel('记录一个新事项').fill('移动端任务');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '添加', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: '移动端任务' })).toBeVisible();

  const overflow = await dashboard.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  await expect(dashboard.getByRole('button', { name: '添加', exact: true })).toBeVisible();
});
