import { test, expect, openDashboard } from './fixtures.js';

test('移动视口下快速新增和任务操作不产生横向溢出', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 390, height: 844 });

  await dashboard.getByLabel('记录一个新事项').fill('移动端任务');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: '移动端任务' })).toBeVisible();

  const overflow = await dashboard.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  await expect(dashboard.getByRole('button', { name: '记录', exact: true })).toBeVisible();
});

test('窄屏下回收站行内删除与设置页危险动作都不产生横向溢出', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 390, height: 844 });

  await dashboard.getByLabel('记录一个新事项').fill('窄屏删除任务');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  const row = dashboard.locator('[data-task-id]').filter({
    has: dashboard.getByRole('button', { name: '窄屏删除任务' }),
  });
  await row.getByText('更多', { exact: true }).click();
  await row.getByRole('button', { name: '移入回收站', exact: true }).click();
  await dashboard.locator('#confirm-dialog').getByRole('button', { name: '移入回收站' }).click();

  const measure = () => dashboard.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  // 回收站行：行尾直接是「永久删除」，不得把标题挤出视口。
  await dashboard.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(dashboard.locator('[data-task-id] .task__danger')).toBeVisible();
  let overflow = await measure();
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  // 设置页：危险动作与三个安全动作之间换行，而不是把整行横向撑开。
  await dashboard.getByRole('button', { name: '设置' }).click();
  await expect(dashboard.locator('#clear-all-data')).toBeVisible();
  overflow = await measure();
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});
