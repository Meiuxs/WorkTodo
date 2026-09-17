import { test, expect, openDashboard } from './fixtures.js';

test('安排今天并完成后进入实际完成的工作记录', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('完成项目报价');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '添加', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: '完成项目报价' })).toBeVisible();

  await dashboard.getByRole('checkbox', { name: '完成任务' }).first().click();
  await expect(dashboard.getByText('已完成任务')).toBeVisible();

  await dashboard.getByRole('button', { name: '工作记录' }).click();
  await expect(dashboard.locator('#page-title')).toHaveText('工作记录');
  await expect(dashboard.getByRole('button', { name: '完成项目报价' })).toBeVisible();
  await expect(dashboard.getByText('实际完成', { exact: true })).toBeVisible();
});

test('取消删除确认后任务保留且删除操作仍可用', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('保留删除前确认');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '添加', exact: true }).click();

  const taskRow = dashboard.locator('[data-task-id]').filter({
    has: dashboard.getByRole('button', { name: '保留删除前确认' }),
  });
  await taskRow.getByText('更多', { exact: true }).click();
  const deleteButton = taskRow.getByRole('button', { name: '删除', exact: true });
  await deleteButton.click();
  const confirmation = dashboard.locator('#confirm-dialog');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '取消' }).click();

  await expect(confirmation).toBeHidden();
  await expect(taskRow).toBeVisible();
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(confirmation).toBeVisible();
});
