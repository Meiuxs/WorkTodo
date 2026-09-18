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
  await dashboard.getByRole('button', { name: '添加', exact: true }).click();
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
  await dashboard.getByRole('button', { name: '添加', exact: true }).click();
  await expect(overdueBadge).toHaveText('1');

  // 处理掉逾期事项后角标重新隐藏。
  await dashboard.getByRole('checkbox', { name: '完成任务' }).first().click();
  await expect(overdueBadge).toBeHidden();
});
