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
