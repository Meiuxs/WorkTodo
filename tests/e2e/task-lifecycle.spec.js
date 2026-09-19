import { test, expect, openDashboard } from './fixtures.js';

test('安排今天并完成后进入实际完成的工作记录', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('完成项目报价');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: '完成项目报价' })).toBeVisible();

  await dashboard.getByRole('checkbox', { name: '完成任务' }).first().click();
  await expect(dashboard.getByText('已完成任务')).toBeVisible();

  await dashboard.getByRole('button', { name: '工作记录' }).click();
  await expect(dashboard.locator('#page-title')).toHaveText('工作记录');
  await expect(dashboard.getByRole('button', { name: '完成项目报价' })).toBeVisible();
  await expect(dashboard.getByText('实际完成', { exact: true })).toBeVisible();
});

test('今日页突出下一步任务并保留可直接记录的入口', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('下一步任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await expect(page.locator('[data-next-action]')).toContainText('下一步任务');
  await expect(page.locator('[data-focus-quick-add]')).toHaveCount(0);
  await expect(page.getByLabel('记录一个新事项')).toBeVisible();
});

test('Dashboard 快速新增撤销不会再次要求确认', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('临时任务');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await dashboard.getByRole('button', { name: '撤销' }).click();
  await expect(dashboard.getByRole('dialog')).toHaveCount(0);
  await expect(dashboard.getByText('已撤销创建')).toBeVisible();
  await dashboard.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: '临时任务' })).toHaveCount(0);
});

test('任务行支持快捷日期和优先级操作', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('快捷操作任务');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await dashboard.getByRole('button', { name: '收集箱', exact: true }).click();
  const row = dashboard.locator('[data-task-id]').filter({ hasText: '快捷操作任务' });
  // 菜单扁平化：改期快捷档直接可见，不再需要先展开“改期”子菜单。
  await row.locator('summary[aria-label="更多任务操作"]').click();
  await row.getByRole('button', { name: /今天 ·/ }).click();
  await dashboard.getByRole('button', { name: '今天', exact: true }).click();
  const refreshedRow = dashboard.locator('[data-task-id]').filter({ hasText: '快捷操作任务' });
  await expect(refreshedRow).toBeVisible();
  // 优先级不再进菜单：行内按 P 沿“无→低”循环，结果由 Toast 反馈。
  await refreshedRow.getByRole('button', { name: '快捷操作任务' }).focus();
  await dashboard.keyboard.press('p');
  await expect(dashboard.getByText('已设为低优先级')).toBeVisible();
  await expect(dashboard.locator('[data-task-id]').filter({ hasText: '快捷操作任务' })).toContainText('低优先级');
  await expect(dashboard.getByRole('button', { name: '快捷操作任务' })).toBeVisible();
});

test('取消删除确认后任务保留且删除操作仍可用', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('保留删除前确认');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();

  const taskRow = dashboard.locator('[data-task-id]').filter({
    has: dashboard.getByRole('button', { name: '保留删除前确认' }),
  });
  await taskRow.getByText('更多', { exact: true }).click();
  const deleteButton = taskRow.getByRole('button', { name: '移入回收站', exact: true });
  await deleteButton.click();
  const confirmation = dashboard.locator('#confirm-dialog');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '取消' }).click();

  await expect(confirmation).toBeHidden();
  await expect(taskRow).toBeVisible();
  // 取消确认后行菜单随“点外收起”关闭，重新展开才能再次看到删除入口。
  await taskRow.getByText('更多', { exact: true }).click();
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(confirmation).toBeVisible();
});
