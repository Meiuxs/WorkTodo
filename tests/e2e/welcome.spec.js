import { test, expect, openDashboard } from './fixtures.js';

test('使用说明清楚展示三步任务流程和本机离线说明', async ({ extension }) => {
  const page = await extension.context.newPage();
  await page.goto(`chrome-extension://${extension.extensionId}/src/welcome/index.html`);

  await expect(page.getByRole('heading', { name: /从今天开始推进。/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '快速记下' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '按需要归类' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '完成或改期' })).toBeVisible();
  await expect(page.getByText('任务保存在本机，可离线使用')).toBeVisible();

  await page.getByRole('link', { name: '打开今日工作台', exact: true }).click();
  await expect(page).toHaveURL(/src\/dashboard\/index\.html#\/today$/);
});

test('设置页提供重新查看使用说明的入口', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '设置', exact: true }).click();

  const guideTabPromise = extension.context.waitForEvent('page');
  await dashboard.getByRole('link', { name: '重新查看使用说明' }).click();
  const guide = await guideTabPromise;
  await expect(guide).toHaveURL(/src\/welcome\/index\.html$/);
  await expect(guide.getByRole('heading', { name: '把记录变成行动' })).toBeVisible();
});
