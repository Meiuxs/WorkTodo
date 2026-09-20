import { test, expect, openDashboard } from './fixtures.js';

test('设置入口位于工作台导航地标内且紧邻最后一个导航项', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  // 窗口要够高，否则侧栏本来就要滚动，量不出“设置被推到底部”这件事。
  await dashboard.setViewportSize({ width: 1280, height: 1000 });

  const nav = dashboard.getByRole('navigation', { name: '工作台导航' });
  const settings = nav.getByRole('button', { name: '设置', exact: true });
  await expect(settings).toBeVisible();

  const gap = await dashboard.evaluate(() => {
    const last = document.querySelector('[data-route="history"]').getBoundingClientRect();
    const entry = document.querySelector('[data-route="settings"]').getBoundingClientRect();
    return entry.top - last.bottom;
  });
  expect(gap).toBeGreaterThan(0);
  expect(gap).toBeLessThan(80);
});

test('矮窗口下导航自身可滚动且设置入口仍能到达并可聚焦', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 1280, height: 560 });

  const nav = dashboard.getByRole('navigation', { name: '工作台导航' });
  const settings = nav.getByRole('button', { name: '设置', exact: true });

  const overflowY = await dashboard.evaluate(() => getComputedStyle(document.querySelector('.nav')).overflowY);
  expect(overflowY).toBe('auto');

  await settings.scrollIntoViewIfNeeded();
  await expect(settings).toBeVisible();
  await settings.focus();
  await expect(settings).toBeFocused();
});
