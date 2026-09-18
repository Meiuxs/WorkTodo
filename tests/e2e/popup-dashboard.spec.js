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

test('Dashboard 导航按旅程分组且新增反馈提供工作台入口', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await expect(dashboard.getByRole('navigation', { name: '工作台导航' }).getByText('计划', { exact: true })).toBeVisible();
  await expect(dashboard.getByRole('navigation', { name: '工作台导航' }).getByText('任务', { exact: true })).toBeVisible();
});
