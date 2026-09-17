import { test, expect, openDashboard } from './fixtures.js';

test('本周视图展示今天所在周的计划任务', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('本周计划事项');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();

  await page.getByRole('button', { name: '本周', exact: true }).click();
  await expect(page.locator('#page-title')).toHaveText('本周');
  await expect(page.getByRole('heading', { name: /本周计划/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '本周计划事项' })).toBeVisible();
});
