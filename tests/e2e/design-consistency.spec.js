import { test, expect, openDashboard } from './fixtures.js';

async function createTodayTask(dashboard, title) {
  await dashboard.getByLabel('记录一个新事项').fill(title);
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
}

test('页面级空状态使用同一结构且不重复表达同一件事', async ({ extension }) => {
  const dashboard = await openDashboard(extension);

  await expect(dashboard.locator('.empty-state__title')).toHaveCount(1);
  await expect(dashboard.locator('.empty-state__title')).toHaveText('今天还没有待办');
  await expect(dashboard.locator('.empty-state__action')).toBeVisible();

  await dashboard.getByRole('button', { name: '收集箱', exact: true }).click();
  await expect(dashboard.locator('.empty-state__title')).toHaveCount(1);
  await expect(dashboard.locator('.empty-state__title')).toHaveText('收集箱是空的');

  await dashboard.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(dashboard.locator('.empty-state__title')).toHaveCount(1);
  await expect(dashboard.locator('.empty-state__title')).toHaveText('回收站是空的');

  // 本周页曾同时出现统计行与虚线卡片两处空状态；现在只允许一处。
  await dashboard.getByRole('button', { name: '本周', exact: true }).click();
  await expect(dashboard.locator('.empty-state')).toHaveCount(1);
  await expect(dashboard.locator('.empty-state__title')).toHaveText('本周还没有计划');
  await expect(dashboard.locator('.week-empty')).toHaveCount(0);
});

test('设置页按数据优先级排列，初始不显示数据状态且列表空状态统一', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '设置', exact: true }).click();

  await expect.poll(() => dashboard.locator('#view-root > .view-section > .section-heading h2').allTextContents())
    .toEqual(['外观', '数据管理', '列表', '键盘快捷键']);
  await expect(dashboard.locator('#data-state .data-state')).toHaveCount(0);
  await expect(dashboard.locator('.category-list .empty-state__title')).toHaveText('还没有列表');
  await expect(dashboard.locator('.category-list .empty-state__text')).toHaveText('创建后可在任务编辑器中分配。');

  await dashboard.setViewportSize({ width: 1280, height: 1000 });
  const categoryFormWidth = await dashboard.locator('#create-category').evaluate((node) => node.getBoundingClientRect().width);
  expect(categoryFormWidth).toBeLessThanOrEqual(720);
});

test('任务菜单用动作名称表达破坏性操作并只保留一个编辑入口', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('术语检查任务');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await dashboard.getByRole('button', { name: '收集箱', exact: true }).click();

  const row = dashboard.locator('[data-task-id]').filter({ hasText: '术语检查任务' });
  await row.locator('summary[aria-label^="更多任务操作"]').click();
  await expect(row.getByRole('button', { name: '移入回收站', exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: '编辑任务', exact: true })).toHaveCount(1);
  await expect(row.getByRole('button', { name: '添加子任务', exact: true })).toHaveCount(0);

  // 恢复是动作，不是勾选：可恢复的行不再声明 checkbox 语义。
  await row.getByRole('checkbox', { name: '完成任务' }).click();
  await dashboard.getByRole('button', { name: '已完成', exact: true }).click();
  const completedRow = dashboard.locator('[data-task-id]').filter({ hasText: '术语检查任务' });
  await expect(completedRow.locator('.task__check')).toHaveAttribute('aria-label', '恢复任务');
  await expect(completedRow.locator('.task__check')).not.toHaveAttribute('role', 'checkbox');
});

test('加星标与取消星标的 Toast 报出新状态，不只说“已更新”', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('星标反馈任务');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await dashboard.getByRole('button', { name: '收集箱', exact: true }).click();

  const row = dashboard.locator('[data-task-id]').filter({ hasText: '星标反馈任务' });
  await row.locator('summary[aria-label^="更多任务操作"]').click();
  await row.getByRole('button', { name: '加星标', exact: true }).click();
  await expect(dashboard.getByText('已加星标')).toBeVisible();
  await expect(row.locator('.task__star')).toHaveAttribute('aria-label', '已标记星标');
  expect(await row.locator('.task__title-line').evaluate((node) => [...node.children].map((child) => child.className)))
    .toEqual(['task__star', 'task__title']);

  // 行内动作会原地刷新、菜单保持展开（见 list-patch carryMenuOpenState）：
  // “取消星标”已在开着的菜单里，直接点它而不是再展开一次（再点会把菜单收起）。
  await expect(row.locator('summary[aria-label^="更多任务操作"]')).toBeVisible();
  await row.getByRole('button', { name: '取消星标', exact: true }).click();
  await expect(dashboard.getByText('已取消星标')).toBeVisible();
  await expect(row.locator('.task__star')).toHaveCount(0);
  await expect(row).not.toContainText('已星标');
});

test('列表从满到空后页面级空状态原地补回', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '最后一个今天任务');
  const row = dashboard.locator('[data-task-id]').filter({ hasText: '最后一个今天任务' });
  await expect(row).toBeVisible();

  // 完成最后一个任务后不能只剩空白：空状态要带着引导文案和入口回到原位。
  await row.getByRole('checkbox', { name: '完成任务' }).click();
  await expect(dashboard.locator('.empty-state__title')).toHaveText('今天还没有待办');
  await expect(dashboard.locator('.empty-state__action')).toBeVisible();

  // 撤销把行搬回来时，空状态占位被同一套协调算法清掉，不留双重表达。
  await dashboard.getByRole('button', { name: '撤销' }).click();
  await expect(dashboard.locator('[data-task-id]').filter({ hasText: '最后一个今天任务' })).toBeVisible();
  await expect(dashboard.locator('.empty-state')).toHaveCount(0);
});

test('抽屉有未保存修改时关闭前先确认', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '未保存任务');
  const titleButton = dashboard.getByRole('button', { name: '未保存任务', exact: true });
  const editor = dashboard.locator('#task-editor');
  const confirmation = dashboard.locator('#confirm-dialog');

  await titleButton.click();
  await expect(editor).toBeVisible();
  await dashboard.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(titleButton).toBeFocused();

  await titleButton.click();
  await editor.getByLabel('任务名称').fill('改过的标题');
  await dashboard.keyboard.press('Escape');
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('heading', { name: '放弃未保存的修改？' })).toBeVisible();

  await confirmation.getByRole('button', { name: '取消' }).click();
  await expect(editor).toBeVisible();

  await dashboard.keyboard.press('Escape');
  await confirmation.getByRole('button', { name: '放弃修改' }).click();
  await expect(editor).toBeHidden();
  await expect(dashboard.getByRole('button', { name: '未保存任务', exact: true })).toBeVisible();
});

test('月历用方向键在日期之间移动焦点', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '月历', exact: true }).click();
  // 月历不声明 grid/gridcell（格子内多个 Tab 停留点与复合角色冲突），按结构断言。
  await expect(dashboard.locator('.month-grid')).toBeVisible();

  const dates = await dashboard.locator('[data-date]').evaluateAll((cells) => cells.map((cell) => cell.dataset.date));
  const todayCell = dashboard.locator('[data-date][aria-current="date"]');
  await expect(todayCell).toHaveAttribute('tabindex', '0');
  const today = await todayCell.getAttribute('data-date');
  const index = dates.indexOf(today);
  const focusedDate = () => dashboard.evaluate(() => document.activeElement?.dataset?.date ?? null);

  await todayCell.focus();
  await dashboard.keyboard.press('ArrowRight');
  await expect.poll(focusedDate).toBe(dates[index + 1]);
  await dashboard.keyboard.press('ArrowDown');
  await expect.poll(focusedDate).toBe(dates[index + 8]);
  await dashboard.keyboard.press('Home');
  await expect.poll(focusedDate).toBe(dates[Math.floor((index + 8) / 7) * 7]);
  await dashboard.keyboard.press('End');
  await expect.poll(focusedDate).toBe(dates[Math.floor((index + 8) / 7) * 7 + 6]);
});
