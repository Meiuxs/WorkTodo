import { test, expect, openDashboard } from './fixtures.js';

test('空标题点“记录”不弹浏览器原生气泡，改为行内提示不创建任务', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  // 表单带 novalidate，阻断浏览器原生的“请填写此字段。”气泡，提交交给 JS 处理。
  await expect(dashboard.locator('#quick-add')).toHaveAttribute('novalidate');
  await dashboard.getByLabel('记录一个新事项').click();
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();

  await expect(dashboard.locator('#quick-add-message')).toHaveText('先写下一件要做的事，再记录。');
  await expect(dashboard.getByLabel('记录一个新事项')).toBeFocused();
  // 未创建任何任务：今日列表仍为空。
  await expect(dashboard.getByText('今天还没有待办')).toBeVisible();
});

test('指定日期未填写时错误定位到日期控件并取消录入区的激活色', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  const quickAdd = dashboard.locator('#quick-add');
  const customDate = dashboard.locator('#quick-add-custom');

  await dashboard.getByLabel('记录一个新事项').fill('缺少日期的事项');
  await dashboard.locator('#quick-add-date').selectOption('custom');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();

  await expect(customDate).toBeFocused();
  await expect(customDate).toHaveAttribute('aria-invalid', 'true');
  await expect(customDate).toHaveAttribute('aria-describedby', 'quick-add-date-message');
  await expect(dashboard.locator('#quick-add-date-message')).toHaveText('请选择任务计划日期。');
  await expect(quickAdd).toHaveClass(/quick-add--error/);

  const colors = await quickAdd.evaluate((form) => ({
    formBorder: getComputedStyle(form).borderTopColor,
    dateBorder: getComputedStyle(form.querySelector('#quick-add-custom')).borderTopColor,
    dateBackground: getComputedStyle(form.querySelector('#quick-add-custom')).backgroundColor,
  }));
  expect(colors.formBorder).toBe('rgb(194, 63, 34)');
  const dateBorderChannels = colors.dateBorder.match(/\d+/g).map(Number);
  const dateBackgroundChannels = colors.dateBackground.match(/\d+/g).map(Number);
  expect(dateBorderChannels[0]).toBeGreaterThan(dateBorderChannels[1]);
  expect(colors.dateBorder).not.toBe('rgb(109, 155, 137)');
  expect(dateBackgroundChannels[0]).toBeGreaterThan(dateBackgroundChannels[1]);
  expect(dateBackgroundChannels[1]).toBeGreaterThan(dateBackgroundChannels[2]);

  await customDate.fill('2026-09-30');
  await expect(dashboard.locator('#quick-add-date-message')).toBeHidden();
  await expect(customDate).not.toHaveAttribute('aria-invalid', 'true');
  await expect(quickAdd).not.toHaveClass(/quick-add--error/);
});

test('安排今天并完成后进入实际完成的工作记录', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('完成项目报价');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: '完成项目报价', exact: true })).toBeVisible();

  await dashboard.getByRole('checkbox', { name: '完成任务' }).first().click();
  await expect(dashboard.getByText('已完成任务')).toBeVisible();

  await dashboard.getByRole('button', { name: '工作记录' }).click();
  await expect(dashboard.locator('#page-title')).toHaveText('工作记录');
  await expect(dashboard.getByRole('button', { name: '完成项目报价', exact: true })).toBeVisible();
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

test('今天全部计划完成后显示庆祝空状态而不是继续催促记录', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  for (const title of ['庆祝完成任务一', '庆祝完成任务二']) {
    await dashboard.getByLabel('记录一个新事项').fill(title);
    await dashboard.locator('#quick-add-date').selectOption('today');
    await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  }

  const tasks = dashboard.locator('#today-list [data-task-id]');
  await expect(tasks).toHaveCount(2);
  for (const title of ['庆祝完成任务一', '庆祝完成任务二']) {
    await dashboard.locator('#today-list [data-task-id]').filter({ hasText: title })
      .getByRole('checkbox', { name: '完成任务' }).click();
  }

  const emptyState = dashboard.locator('#today-list .empty-state');
  await expect(emptyState).toBeVisible();
  await expect(emptyState.locator('.empty-state__art')).toBeVisible();
  await expect(emptyState.locator('.empty-state__title')).toHaveText('太棒了！今天的任务已全部搞定');
  await expect(emptyState.locator('.empty-state__text')).toHaveText('今日事今日毕，为你点赞。好好休息一下吧！');
  await expect(emptyState).not.toContainText('在上方写下你的第一个任务');
  await expect(dashboard.locator('.today-summary__metric strong')).toHaveText('2 / 2');
  await expect(dashboard.locator('.progress-block .eyebrow')).toHaveText('完成率 100%');
  await expect(dashboard.locator('[data-next-action]')).toContainText('全部搞定');
  await expect(dashboard.locator('[data-next-action]')).toContainText('好好休息一下吧');
  await expect(dashboard.getByLabel('记录一个新事项')).toBeVisible();
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
  await expect(restoredRow.locator('.task__check')).toHaveAttribute('aria-label', '完成任务：恢复状态任务');
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
  await expect(restoredRow.locator('.task__check')).toHaveAttribute('aria-label', '完成任务：折叠区恢复任务');
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
  await dashboard.locator('#quick-add-date').selectOption('inbox');
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
  await taskRow.locator('summary[aria-label^="更多任务操作"]').click();
  await taskRow.getByRole('button', { name: '移入回收站', exact: true }).click();

  // 可撤销的动作不用确认框拦一道：行直接离开列表，反馈只有一条带秒数的 Toast。
  await expect(dashboard.locator('#confirm-dialog')).toBeHidden();
  await expect(dashboard.getByText('已移入回收站，5 秒内可撤销')).toBeVisible();
  await expect(dashboard.locator('#toast')).toBeHidden({ timeout: 6000 });
  await dashboard.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(dashboard.locator('[data-task-id]').filter({ hasText: '可撤销删除任务' })).toBeVisible();

  // 撤销是唯一的二次机会：回收站行首圆环承担恢复，它是动作按钮而不是勾选。
  await dashboard.locator('[data-task-id]').filter({ hasText: '可撤销删除任务' })
    .getByRole('button', { name: '恢复任务：可撤销删除任务', exact: true }).click();
  await dashboard.getByRole('button', { name: '今天', exact: true }).click();
  await expect(dashboard.locator('[data-task-id]').filter({ hasText: '可撤销删除任务' })).toBeVisible();
});
