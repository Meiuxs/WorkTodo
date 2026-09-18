import { test, expect, openDashboard } from './fixtures.js';

test('资料收集箱可以创建、搜索并关联网页资料', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '资料收集箱' }).click();
  await expect(dashboard.locator('#resources-heading')).toBeVisible();

  await dashboard.getByRole('button', { name: '添加资料' }).click();
  const createDialog = dashboard.getByRole('dialog');
  await createDialog.getByLabel('资料名称').fill('项目规范');
  await createDialog.locator('[data-resource-url]').fill('https://example.com/spec');
  await createDialog.getByRole('button', { name: '保存资料' }).click();
  await expect(dashboard.getByText('项目规范')).toBeVisible();
  await expect(dashboard.getByText('未关联任务')).toBeVisible();

  await dashboard.getByLabel('搜索资料').fill('example.com');
  await expect(dashboard.getByText('项目规范')).toBeVisible();
});
