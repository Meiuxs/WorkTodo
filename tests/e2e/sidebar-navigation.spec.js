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

test('设置条目与普通导航项共用同一组基础样式', async ({ extension }) => {
  const dashboard = await openDashboard(extension);

  const read = (route) => dashboard.evaluate((selector) => {
    const style = getComputedStyle(document.querySelector(selector));
    return {
      minHeight: style.minHeight,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      borderRadius: style.borderRadius,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      borderLeftWidth: style.borderLeftWidth,
    };
  }, `[data-route="${route}"]`);

  // 颜色与上边框是刻意保留的差异，所以这里只比对几何与排版。
  expect(await read('settings')).toEqual(await read('history'));
});

test('390px 下侧栏排布、选中态与分隔线保持不变', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 390, height: 844 });

  const nav = await dashboard.evaluate(() => {
    const navStyle = getComputedStyle(document.querySelector('.nav'));
    return {
      direction: navStyle.flexDirection,
      wrap: navStyle.flexWrap,
      groupBasis: getComputedStyle(document.querySelector('.nav__group')).flexBasis,
      sidebarPosition: getComputedStyle(document.querySelector('.sidebar')).position,
      labelDisplay: getComputedStyle(document.querySelector('.nav__label')).display,
      footerBorder: getComputedStyle(document.querySelector('.nav__footer')).borderTopWidth,
    };
  });
  expect(nav.direction).toBe('row');
  expect(nav.wrap).toBe('wrap');
  expect(nav.groupBasis).toBe('140px');
  expect(nav.sidebarPosition).toBe('static');
  expect(nav.labelDisplay).toBe('none');
  expect(nav.footerBorder).toBe('1px');

  // 窄屏选中标记从左侧竖条换成下边框。
  await dashboard.getByRole('button', { name: '明天', exact: true }).click();
  // button 有 120ms 的 border-color 过渡，下边框是从 transparent 过渡来的，
  // 直接读会拿到 rgba 半透明中间帧，必须等到过渡结束。
  await expect.poll(() => dashboard.evaluate(() => {
    const style = getComputedStyle(document.querySelector('[data-route="tomorrow"]'));
    return `${style.borderBottomColor} ${style.borderLeftWidth}`;
  })).toBe('rgb(39, 107, 108) 0px');
});

test('390px 下导航条目全部可见且没有横向溢出', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 390, height: 844 });

  const labels = ['今天', '明天', '本周', '月历', '收集箱', '资料收集箱', '全部任务', '已完成', '回收站', '工作记录', '设置'];
  for (const label of labels) {
    await expect(dashboard.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await dashboard.getByLabel('记录一个新事项').fill('窄屏侧栏任务');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: '窄屏侧栏任务' })).toBeVisible();

  const layout = await dashboard.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    contentPaddingBottom: getComputedStyle(document.querySelector('.content')).paddingBottom,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  // A 段那个 140px 底部内边距早已被 B 段覆盖，取两者中生效的值。
  expect(layout.contentPaddingBottom).toBe('24px');
});
