import { test, expect, openPopup, openDashboard } from './fixtures.js';

test('Popup 快速新增任务后 Dashboard 收集箱可见且刷新后仍存在', async ({ extension }) => {
  const popup = await openPopup(extension);
  await popup.getByLabel('记录一个新事项').fill('联系客户');
  await popup.getByRole('button', { name: '添加任务' }).click();
  await expect(popup.getByText('已添加到收集箱')).toBeVisible();

  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '收集箱' }).click();
  await expect(dashboard.getByRole('heading', { name: '收集箱 · 1' })).toBeVisible();
  await expect(dashboard.getByRole('button', { name: '联系客户' })).toBeVisible();

  await dashboard.reload();
  await dashboard.getByRole('button', { name: '收集箱' }).click();
  await expect(dashboard.getByRole('button', { name: '联系客户' })).toBeVisible();
});
