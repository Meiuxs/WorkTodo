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

test('设置入口用分隔线和弱化色表达次级，且不占用分组标签', async ({ extension }) => {
  const dashboard = await openDashboard(extension);

  await expect(dashboard.locator('.nav__footer .nav__label')).toHaveCount(0);

  const style = await dashboard.evaluate(() => {
    const footer = getComputedStyle(document.querySelector('.nav__footer'));
    const button = getComputedStyle(document.querySelector('[data-route="settings"]'));
    return {
      borderTopWidth: footer.borderTopWidth,
      borderTopStyle: footer.borderTopStyle,
      borderTopColor: footer.borderTopColor,
      color: button.color,
      minHeight: button.minHeight,
      fontSize: button.fontSize,
      fontWeight: button.fontWeight,
    };
  });

  expect(style.borderTopWidth).toBe('1px');
  expect(style.borderTopStyle).toBe('solid');
  expect(style.borderTopColor).toBe('rgb(207, 222, 216)'); // --line 浅色 #cfded8
  expect(style.color).toBe('rgb(89, 106, 103)');           // --muted 浅色 #596a67
  // 层级差只由颜色承担：尺寸与普通条目一致。
  expect(style.minHeight).toBe('44px');
  expect(style.fontSize).toBe('14px');
  expect(style.fontWeight).toBe('400');
});

test('设置入口悬停回到主文字色、被选中时回到动作色', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  const settings = dashboard.getByRole('button', { name: '设置', exact: true });

  await settings.hover();
  await expect.poll(() => settings.evaluate((node) => getComputedStyle(node).color))
    .toBe('rgb(24, 51, 49)'); // --ink 浅色 #183331

  await settings.click();
  await expect(dashboard.locator('#page-title')).toHaveText('设置');

  // base.css:89-102 给所有 button 挂了 120ms 的 color / border-color 过渡，
  // 点击后立刻读计算样式会读到 --ink→--teal 的中间帧，必须等到过渡结束。
  await expect.poll(() => settings.evaluate((node) => {
    const style = getComputedStyle(node);
    return `${style.color} ${style.borderLeftColor} ${style.fontWeight}`;
  })).toBe('rgb(39, 107, 108) rgb(39, 107, 108) 700'); // --teal 浅色 #276b6c
});

test('深色主题下侧栏分隔线仍与画布背景可区分', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  // initialize() 会调用 applyTheme 覆写 data-theme，必须等它跑完再手动切换，
  // 否则会被重置回浅色；.app 由 hidden 变为可见正是初始化完成的信号。
  await expect(dashboard.locator('.app')).toBeVisible();
  await dashboard.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  const style = await dashboard.evaluate(() => ({
    border: getComputedStyle(document.querySelector('.nav__footer')).borderTopColor,
    canvas: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
  }));

  expect(style.border).toBe('rgb(49, 80, 75)');  // --line 深色 #31504b
  expect(style.canvas).toBe('rgb(16, 32, 31)');  // --canvas 深色 #10201f
  expect(style.border).not.toBe(style.canvas);
});
