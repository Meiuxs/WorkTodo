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

test('设置页用分区面板组织，危险动作独立成最下方的危险区域', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 1280, height: 1000 });
  await dashboard.getByRole('button', { name: '设置', exact: true }).click();

  // 四块分区面板，顺序与信息优先级一致（规范 §4.13）。
  await expect(dashboard.locator('#view-root > .view-section--panel')).toHaveCount(4);

  // 危险动作不在数据管理区的动作排里，而是单独成块并排在页面最后。
  await expect(dashboard.locator('#data-management .button-danger')).toHaveCount(0);
  const sections = dashboard.locator('#view-root > .view-section');
  await expect(sections).toHaveCount(5);
  await expect(sections.nth(4)).toHaveClass(/view-section--danger/);
  await expect(dashboard.locator('.danger-zone #clear-all-data')).toBeVisible();

  // 危险区域用珊瑚色边界圈出，与普通面板的 --line 边界不同色。
  const dangerBorder = await dashboard.locator('.danger-zone').evaluate((node) => getComputedStyle(node).borderTopColor);
  const panelBorder = await dashboard.locator('.view-section--panel').first().evaluate((node) => getComputedStyle(node).borderTopColor);
  expect(dangerBorder).not.toBe(panelBorder);
});

async function createCategory(dashboard, name) {
  await dashboard.locator('#new-category').fill(name);
  await dashboard.getByRole('button', { name: '创建列表' }).click();
  await expect(dashboard.locator('.category-row__name', { hasText: name })).toHaveCount(1);
}

test('列表管理的创建表单把标签折进 placeholder，创建是实心主按钮', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '设置', exact: true }).click();

  const form = dashboard.locator('#create-category');
  // 可见标签退场，规则交给 placeholder；sr-only 标签仍为读屏保留可访问名。
  await expect(form.locator('label')).toHaveClass(/sr-only/);
  await expect(form.locator('#new-category')).toHaveAttribute('placeholder', '输入新列表名称……');
  await expect(form.getByLabel('新列表名称')).toHaveAttribute('id', 'new-category');

  const create = form.getByRole('button', { name: '创建列表' });
  await expect(create).toHaveClass(/button-primary/);
  const formBox = await form.boundingBox();
  const createBox = await create.boundingBox();
  // 输入框与按钮同排且垂直居中，按钮不落在下一行；整行也不再被拉满一屏。
  expect(Math.abs((formBox.y + formBox.height / 2) - (createBox.y + createBox.height / 2))).toBeLessThanOrEqual(1);
  expect(formBox.width).toBeLessThanOrEqual(560);
});

test('列表行是只读行结构，重命名与删除用行尾图标完成', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '设置', exact: true }).click();
  await createCategory(dashboard, '客户');
  await createCategory(dashboard, '内部');

  const rows = dashboard.locator('.category-row');
  await expect(rows).toHaveCount(2);
  // 只读行不再常驻输入框：名称是一段文字，动作只有图标（aria-label 带列表名）。
  await expect(rows.locator('input')).toHaveCount(0);
  const row = rows.filter({ hasText: '内部' });
  await expect(row.getByRole('button', { name: '重命名列表：内部' })).toBeVisible();
  const renameBox = await row.getByRole('button', { name: '重命名列表：内部' }).boundingBox();
  const deleteBox = await row.getByRole('button', { name: '删除列表：内部' }).boundingBox();
  // 高危的删除动作固定排在行尾。
  expect(deleteBox.x).toBeGreaterThan(renameBox.x);

  // 卡片自身的边界已经收尾：最后一行不画下边线，中间行保留一条分隔线。
  expect(await rows.first().evaluate((node) => getComputedStyle(node).borderBottomWidth)).toBe('1px');
  expect(await rows.last().evaluate((node) => getComputedStyle(node).borderBottomWidth)).toBe('0px');

  // 重命名：名称就地换成输入框（编辑行的文本在 value 里，不参与 hasText 匹配），
  // Enter 保存后回到只读行，焦点留在同一个图标上。
  await row.getByRole('button', { name: '重命名列表：内部' }).click();
  const editor = dashboard.locator('.category-row--editing');
  await editor.locator('input').fill('团队');
  await editor.locator('input').press('Enter');
  await expect(dashboard.locator('.category-row--editing')).toHaveCount(0);
  await expect(dashboard.locator('.category-row__name', { hasText: '团队' })).toHaveCount(1);
  expect((await dashboard.locator('.category-row__name').allTextContents()).sort()).toEqual(['客户', '团队'].sort());
  await expect(dashboard.getByRole('button', { name: '重命名列表：团队' })).toBeFocused();

  // 删除：走迁移确认对话框，默认焦点落在取消；确认后行消失。
  await dashboard.getByRole('button', { name: '删除列表：团队' }).click();
  const dialog = dashboard.locator('#delete-category-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[value="cancel"]')).toBeFocused();
  await dialog.getByRole('button', { name: '删除并迁移' }).click();
  await expect(rows).toHaveCount(1);

  // 删掉最后一条后空状态回到原位，焦点退回创建输入框；空状态也不与卡片底边叠成双线。
  await dashboard.getByRole('button', { name: '删除列表：客户' }).click();
  await dialog.getByRole('button', { name: '删除并迁移' }).click();
  await expect(dashboard.locator('.category-list .empty-state__title')).toHaveText('还没有列表');
  const emptyBorder = await dashboard.locator('.category-list .empty-state').evaluate((node) => getComputedStyle(node).borderBottomWidth);
  expect(emptyBorder).toBe('0px');
  await expect(dashboard.locator('#new-category')).toBeFocused();
});

test('快捷键清单宽屏两列、窄屏单列，语义仍是表格', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 1280, height: 1000 });
  await dashboard.getByRole('button', { name: '设置', exact: true }).click();

  const table = dashboard.locator('.shortcuts-table');
  // 换列只改视觉列数：单元格与行表头角色保持，读屏仍能逐条读到快捷键。
  await expect(table.getByRole('rowheader')).toHaveCount(7);
  await expect(table.getByRole('cell')).toHaveCount(7);

  const rowTops = () => table.locator('tr').evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().top)));
  const wideTops = await rowTops();
  expect(wideTops[0]).toBe(wideTops[1]);
  expect(wideTops[2]).toBeGreaterThan(wideTops[0]);

  await dashboard.setViewportSize({ width: 390, height: 844 });
  const narrowTops = await rowTops();
  expect(new Set(narrowTops).size).toBe(narrowTops.length);
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
  await expect(completedRow.locator('.task__check')).toHaveAttribute('aria-label', '恢复任务：术语检查任务');
  await expect(completedRow.locator('.task__check')).not.toHaveAttribute('role', 'checkbox');
  await expect(completedRow.locator('.task__check')).toHaveClass(/task__check--restore/);
  await expect(completedRow.locator('.task__check')).toHaveText('✓');
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

test('任务行标签独立成块，超过两个折叠为 +N 且全文留在 title', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '标签展示任务');
  await dashboard.getByRole('button', { name: '标签展示任务', exact: true }).click();
  const dialog = dashboard.getByRole('dialog');
  await dialog.locator('[data-editor-group="tags"] > summary').click();
  for (const name of ['客户', '报价', '本周']) {
    await dialog.locator('#new-tag').fill(name);
    await dialog.locator('[data-create-tag]').click();
    await dialog.getByRole('checkbox', { name, exact: true }).check();
  }
  await expect(dialog.locator('input[name="tagIds"]:checked')).toHaveCount(3);
  await dialog.getByRole('button', { name: '保存任务' }).click();
  await expect(dialog).toBeHidden();

  const row = dashboard.locator('[data-task-id]').filter({ hasText: '标签展示任务' });
  // 标签不跟日期、优先级抢整行的省略号：前两个平铺，其余折叠成计数。
  // 标签顺序由任务自身的 tagIds 决定，这里只断言"两个 + 计数"，不锁定具体顺序。
  await expect(row.locator('.task__tags')).toHaveText(/^#[^\s#]+ #[^\s#]+ \+1$/);
  const tagTitle = await row.locator('.task__tags').getAttribute('title');
  for (const name of ['#客户', '#报价', '#本周']) {
    expect(tagTitle).toContain(name);
  }
  // 标签块与可截断文本段并列，宽度不足时只压缩文本段。
  expect(await row.locator('.task__meta').evaluate((node) => [...node.children].map((child) => child.className)))
    .toEqual(['task__meta-text', 'task__tags']);
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
