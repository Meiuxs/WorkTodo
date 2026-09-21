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

test('完成任务后今日摘要、下一步和数量同步更新', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  for (const title of ['先完成的任务', '继续推进的任务']) {
    await dashboard.getByLabel('记录一个新事项').fill(title);
    await dashboard.locator('#quick-add-date').selectOption('today');
    await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  }

  await expect(dashboard.locator('.today-summary__metric strong')).toHaveText('0 / 2');
  await expect(dashboard.locator('.progress-block .eyebrow')).toHaveText('完成率 0%');
  await expect(dashboard.locator('#today-tasks-heading')).toHaveText('今天 · 2');

  const firstTask = dashboard.locator('[data-task-id]').filter({ hasText: '先完成的任务' });
  await firstTask.getByRole('checkbox', { name: '完成任务' }).click();

  await expect(dashboard.locator('.today-summary__metric strong')).toHaveText('1 / 2');
  await expect(dashboard.locator('.progress-block .eyebrow')).toHaveText('完成率 50%');
  await expect(dashboard.locator('#today-tasks-heading')).toHaveText('今天 · 1');
  await expect(dashboard.locator('[data-next-task]')).toHaveText('继续推进的任务');
  await expect(dashboard.locator('#completed-today-count')).toHaveText('已完成 1 项');
});

test('完成首个任务后，已完成折叠区的更多动作仍可用', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('已完成菜单任务');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();

  const row = dashboard.locator('[data-task-id]').filter({ hasText: '已完成菜单任务' });
  await row.getByRole('checkbox', { name: '完成任务' }).click();
  await dashboard.locator('#completed-today-count').click();

  const completedRow = dashboard.locator('#completed-today-list [data-task-id]').filter({ hasText: '已完成菜单任务' });
  await completedRow.locator('summary[aria-label^="更多任务操作"]').click();
  await completedRow.getByRole('button', { name: '复制', exact: true }).click();
  await expect(dashboard.getByText('已复制为新任务')).toBeVisible();
});

test('已完成任务恢复后显示为待办状态', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('恢复状态任务');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();

  const row = dashboard.locator('[data-task-id]').filter({ hasText: '恢复状态任务' });
  await row.getByRole('checkbox', { name: '完成任务' }).click();
  await dashboard.getByRole('button', { name: '工作记录', exact: true }).click();

  const completedRow = dashboard.locator('[data-task-id]').filter({ hasText: '恢复状态任务' });
  await completedRow.locator('summary[aria-label^="更多任务操作"]').click();
  await completedRow.getByRole('button', { name: '恢复待办', exact: true }).click();
  await expect(dashboard.getByText('已恢复为待办')).toBeVisible();
  await expect(completedRow).toHaveCount(0);

  await dashboard.getByRole('button', { name: '今天', exact: true }).click();
  const restoredRow = dashboard.locator('[data-task-id]').filter({ hasText: '恢复状态任务' });
  await expect(restoredRow).toContainText('待办');
  await expect(restoredRow.locator('.task__check')).toHaveAttribute('aria-label', '完成任务');
});

test('今日已完成折叠区恢复待办后任务状态正确', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('折叠区恢复任务');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();

  const row = dashboard.locator('[data-task-id]').filter({ hasText: '折叠区恢复任务' });
  await row.getByRole('checkbox', { name: '完成任务' }).click();
  await dashboard.locator('#completed-today-count').click();
  const completedRow = dashboard.locator('#completed-today-list [data-task-id]').filter({ hasText: '折叠区恢复任务' });
  await completedRow.locator('summary[aria-label^="更多任务操作"]').click();
  await completedRow.getByRole('button', { name: '恢复待办', exact: true }).click();

  const restoredRow = dashboard.locator('#today-list [data-task-id]').filter({ hasText: '折叠区恢复任务' });
  await expect(restoredRow).toContainText('待办');
  await expect(restoredRow.locator('.task__check')).toHaveAttribute('aria-label', '完成任务');
  await expect(restoredRow.locator('.task__more[open]')).toHaveCount(0);
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
  await row.locator('summary[aria-label^="更多任务操作"]').click();
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

test('移入回收站不再叠加确认框，撤销窗口可把任务取回', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('可撤销删除任务');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();

  const taskRow = dashboard.locator('[data-task-id]').filter({
    has: dashboard.getByRole('button', { name: '可撤销删除任务' }),
  });
  await taskRow.getByText('更多', { exact: true }).click();
  await taskRow.getByRole('button', { name: '移入回收站', exact: true }).click();

  // 可撤销的动作不用确认框拦一道：行直接离开列表，反馈只有一条带秒数的 Toast。
  await expect(dashboard.locator('#confirm-dialog')).toBeHidden();
  await expect(dashboard.getByText('已移入回收站，10 秒内可撤销')).toBeVisible();
  await dashboard.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(dashboard.locator('[data-task-id]').filter({ hasText: '可撤销删除任务' })).toBeVisible();

  // 撤销是唯一的二次机会：回收站行首圆环承担恢复，它是动作按钮而不是勾选。
  await dashboard.locator('[data-task-id]').filter({ hasText: '可撤销删除任务' })
    .getByRole('button', { name: '恢复任务', exact: true }).click();
  await dashboard.getByRole('button', { name: '今天', exact: true }).click();
  await expect(dashboard.locator('[data-task-id]').filter({ hasText: '可撤销删除任务' })).toBeVisible();
});
