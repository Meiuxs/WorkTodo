import { test, expect, openDashboard, openPopup } from './fixtures.js';

test('今日工作台把快速记录作为首屏主入口并采用线性布局', async ({ extension }) => {
  const dashboard = await openDashboard(extension);

  await expect(dashboard.locator('.quick-add__lead')).toBeVisible();
  await expect(dashboard.locator('.quick-add__lead')).toContainText('快速记录');
  await expect(dashboard.locator('.today-focus')).toBeVisible();

  const layout = await dashboard.evaluate(() => ({
    app: getComputedStyle(document.querySelector('.app')).display,
    quickAdd: getComputedStyle(document.querySelector('.quick-add')).display,
  }));

  expect(layout.app).toBe('flex');
  expect(layout.quickAdd).toBe('flex');
});

test('Popup 先让用户记录，再展示少量今日重点', async ({ extension }) => {
  const popup = await openPopup(extension);

  await expect(popup.locator('.popup__capture-label')).toContainText('快速记录');
  await expect(popup.getByPlaceholder('写下下一件要推进的事……')).toBeVisible();
  await expect(popup.getByRole('heading', { name: '今天要推进' })).toBeVisible();
});

test('快捷键导航后侧栏选中项同步更新', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  const nav = dashboard.getByRole('navigation', { name: '工作台导航' });
  const navItem = (name) => nav.getByRole('button', { name, exact: true });

  await expect(navItem('今天')).toHaveAttribute('aria-current', 'page');

  // 焦点要先离开可编辑控件，页面快捷键才生效。
  await dashboard.locator('#page-title').click();

  await dashboard.keyboard.press('w');
  await expect(dashboard.locator('#page-title')).toHaveText('本周');
  await expect(navItem('本周')).toHaveAttribute('aria-current', 'page');
  await expect(navItem('今天')).not.toHaveAttribute('aria-current', 'page');

  await dashboard.keyboard.press('m');
  await expect(dashboard.locator('#page-title')).toHaveText('月历');
  await expect(navItem('月历')).toHaveAttribute('aria-current', 'page');

  await dashboard.keyboard.press('t');
  await expect(dashboard.locator('#page-title')).toHaveText('今日工作');
  await expect(navItem('今天')).toHaveAttribute('aria-current', 'page');
  await expect(navItem('月历')).not.toHaveAttribute('aria-current', 'page');

  // 选中项不能只改属性：用户看到的是字重与底色，这里确认视觉也跟上了。
  const weights = await dashboard.evaluate(() => ({
    current: getComputedStyle(document.querySelector('[data-route="today"]')).fontWeight,
    other: getComputedStyle(document.querySelector('[data-route="month"]')).fontWeight,
  }));
  expect(weights.current).toBe('700');
  expect(weights.other).toBe('400');
});

test('侧栏角标提示逾期与待整理数量且不改变导航项名称', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  const nav = dashboard.getByRole('navigation', { name: '工作台导航' });
  const overdueBadge = dashboard.locator('[data-nav-badge="today"]');
  const inboxBadge = dashboard.locator('[data-nav-badge="inbox"]');

  // 没有待处理事项时不占位。
  await expect(overdueBadge).toBeHidden();
  await expect(inboxBadge).toBeHidden();

  // 只写标题的新事项落在收集箱，角标随之出现；
  // 角标同时标了 aria-hidden，所以按钮的可访问名称仍然是干净的两个字。
  await dashboard.getByLabel('记录一个新事项').fill('待整理事项');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await expect(inboxBadge).toHaveText('1');
  await expect(nav.getByRole('button', { name: '收集箱', exact: true })).toBeVisible();

  // 计划日期早于今天的任务计入逾期角标。
  const pastDate = await dashboard.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 2);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  await dashboard.getByLabel('记录一个新事项').fill('逾期事项');
  await dashboard.locator('#quick-add-date').selectOption('custom');
  await dashboard.locator('#quick-add-custom').fill(pastDate);
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await expect(overdueBadge).toHaveText('1');

  // 处理掉逾期事项后角标重新隐藏。
  await dashboard.getByRole('checkbox', { name: '完成任务' }).first().click();
  await expect(overdueBadge).toBeHidden();
});

test('hash 深链 #/week 直接打开周视图', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.goto(`chrome-extension://${extension.extensionId}/src/dashboard/index.html#/week`);

  await expect(dashboard.locator('#page-title')).toHaveText('本周');
  await expect(dashboard.getByRole('navigation', { name: '工作台导航' })
    .getByRole('button', { name: '本周', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('刷新后停留在原路由且筛选条件恢复', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('刷新保留筛选');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();

  await dashboard.getByRole('button', { name: '全部任务' }).click();
  await expect(dashboard.locator('#all-tasks-heading')).toBeVisible();
  await dashboard.getByLabel('搜索').fill('刷新保留');
  await dashboard.getByLabel('状态').selectOption('todo');
  await expect(dashboard.getByRole('button', { name: '刷新保留筛选' })).toBeVisible();
  await expect(dashboard).toHaveURL(/#\/all\?/);

  await dashboard.reload();
  await expect(dashboard.locator('#page-title')).toHaveText('全部任务');
  await expect(dashboard.getByLabel('搜索')).toHaveValue('刷新保留');
  await expect(dashboard.getByLabel('状态')).toHaveValue('todo');
  await expect(dashboard.getByRole('button', { name: '刷新保留筛选' })).toBeVisible();
});

test('完成任务后滚动位置与其他行菜单展开态保持', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  for (let index = 1; index <= 8; index += 1) {
    await dashboard.getByLabel('记录一个新事项').fill(`滚动保持任务 ${index}`);
    await dashboard.locator('#quick-add-date').selectOption('today');
    await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  }

  // 等 8 行全部渲染完再设滚动位置。列表没渲染完时文档不够高，scrollTo 会被钳成 0：
  // 基线于是记成 0，随后 Playwright 点击末行时先触发自动滚动把它滚入视口，
  // 断言就变成在比"点击带来的滚动"而不是"完成操作是否保持滚动位置"。
  await expect(dashboard.locator('#today-list [data-task-id]')).toHaveCount(8);
  await dashboard.evaluate(() => window.scrollTo(0, 300));
  const rowByTitle = (title) => dashboard.locator('#today-list [data-task-id]').filter({ has: dashboard.getByRole('button', { name: title, exact: true }) });
  const bystander = rowByTitle('滚动保持任务 1');
  const victim = rowByTitle('滚动保持任务 8');
  // 在“旁观点”行节点上贴一个内存标记：只有同一 DOM 节点存活到 patch 后才能读到它。
  await bystander.evaluate((row) => { row.__keptAlive = true; });
  const scrollBefore = await dashboard.evaluate(() => window.scrollY);
  const topBefore = await bystander.evaluate((row) => row.getBoundingClientRect().top);

  // 完成靠后位置的一行：只移除该行、不重建列表，上方行节点与滚动位置均不变。
  await victim.getByRole('checkbox', { name: '完成任务' }).click();
  await expect(dashboard.getByRole('button', { name: '滚动保持任务 8' })).toHaveCount(0);
  await expect(dashboard.locator('#today-list [data-task-id]')).toHaveCount(7);

  // 未变行的 DOM 节点被原样保留（标记存活），证明没有 innerHTML 重建。
  expect(await bystander.evaluate((row) => row.__keptAlive === true)).toBe(true);
  expect(Math.abs(await dashboard.evaluate(() => window.scrollY) - scrollBefore)).toBeLessThan(8);
  expect(Math.abs(await bystander.evaluate((row) => row.getBoundingClientRect().top) - topBefore)).toBeLessThan(8);
});

test('Popup 点击圆环完成任务并可撤销', async ({ extension }) => {
  const popup = await openPopup(extension);
  await popup.getByLabel('记录一个新事项').fill('弹窗完成任务');
  await popup.getByRole('button', { name: '今天', exact: true }).click();
  await popup.getByRole('button', { name: '添加任务' }).click();

  const row = popup.locator('#focus-list .task-row').filter({ hasText: '弹窗完成任务' });
  await expect(row).toBeVisible();
  // 标题在窄弹窗里会被单行截断，全文必须能通过 title 取回（规范 §3.2）。
  await expect(row.locator('.task-row__title')).toHaveAttribute('title', '弹窗完成任务');
  await row.getByRole('checkbox', { name: '完成任务' }).click();
  await expect(popup.locator('#toast')).toContainText('已完成任务');
  await expect(row).toHaveCount(0);

  await popup.getByRole('button', { name: '撤销' }).click();
  await expect(popup.locator('#toast')).toContainText('已撤销完成');
  await expect(row).toBeVisible();
});

test('快捷键完整清单集中在设置页，入口不再就地展示徽标', async ({ extension }) => {
  const dashboard = await openDashboard(extension);

  // 侧栏与快速记录不再带就地 kbd 徽标。
  await expect(dashboard.locator('.nav .kbd')).toHaveCount(0);
  await expect(dashboard.locator('.quick-add .kbd')).toHaveCount(0);

  await dashboard.getByRole('button', { name: '设置' }).click();
  await expect(dashboard.locator('#shortcuts-heading')).toBeVisible();
  const table = dashboard.locator('.shortcuts-table');
  // 隐藏知识 D/P 也必须在清单里能看到。
  await expect(table.getByRole('cell', { name: /循环优先级/ })).toBeVisible();
  await expect(table.getByRole('cell', { name: /展开菜单并选中改期/ })).toBeVisible();
  await expect(table.locator('.kbd')).toHaveCount(7);
});
