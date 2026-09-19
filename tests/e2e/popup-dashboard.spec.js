import { test, expect, openPopup, openDashboard } from './fixtures.js';

test('Popup 快速新增任务后 Dashboard 收集箱可见且刷新后仍存在', async ({ extension }) => {
  const popup = await openPopup(extension);
  await popup.getByLabel('记录一个新事项').fill('联系客户');
  await popup.getByRole('button', { name: '添加任务' }).click();
  await expect(popup.getByText('已添加到收集箱')).toBeVisible();
  await expect(popup.getByRole('button', { name: '打开工作台' })).toBeVisible();

  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '收集箱', exact: true }).click();
  await expect(dashboard.getByRole('heading', { name: '收集箱 · 1' })).toBeVisible();
  await expect(dashboard.getByRole('button', { name: '联系客户' })).toBeVisible();

  await dashboard.reload();
  await dashboard.getByRole('button', { name: '收集箱', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: '联系客户' })).toBeVisible();
});

test('Popup 快速新增可直接撤销创建', async ({ extension }) => {
  const popup = await openPopup(extension);
  await popup.getByLabel('记录一个新事项').fill('误记任务');
  await popup.getByRole('button', { name: '添加任务' }).click();
  await popup.getByRole('button', { name: '撤销' }).click();
  await expect(popup.getByText('已撤销创建')).toBeVisible();

  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '收集箱', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: '误记任务' })).toHaveCount(0);
  await dashboard.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: '误记任务' })).toHaveCount(0);
});

test('Popup 成功反馈不遮挡底部日期选择', async ({ extension }) => {
  const popup = await openPopup(extension);
  await popup.getByLabel('记录一个新事项').fill('检查反馈位置');
  await popup.getByRole('button', { name: '添加任务' }).click();
  await expect(popup.getByText('已添加到收集箱')).toBeVisible();

  const positions = await popup.evaluate(() => {
    const toast = document.querySelector('#toast').getBoundingClientRect();
    const dateOptions = document.querySelector('.popup__date-options').getBoundingClientRect();
    return { toastTop: toast.top, dateOptionsBottom: dateOptions.bottom };
  });
  expect(positions.toastTop).toBeGreaterThanOrEqual(positions.dateOptionsBottom);
});

test('工作记录先显示结论，生成总结后再展开文本编辑区域', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '工作记录' }).click();

  await expect(dashboard.getByText('先看结论，再按需生成可复制总结。')).toBeVisible();
  await expect(dashboard.getByLabel('总结文本')).toBeHidden();
  await expect(dashboard.getByRole('button', { name: '复制总结' })).toBeHidden();

  await dashboard.getByRole('button', { name: '生成本周总结' }).click();
  await expect(dashboard.getByLabel('总结文本')).toBeVisible();
  await expect(dashboard.getByRole('button', { name: '复制总结' })).toBeVisible();
});

test('Dashboard 导航按旅程分组且新增反馈提供工作台入口', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await expect(dashboard.getByRole('navigation', { name: '工作台导航' }).getByText('计划', { exact: true })).toBeVisible();
  await expect(dashboard.getByRole('navigation', { name: '工作台导航' }).getByText('任务', { exact: true })).toBeVisible();
});
