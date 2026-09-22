import { test, expect, openDashboard } from './fixtures.js';

test('桌面今日摘要保持紧凑并把任务列表放在首要视觉位置', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel('记录一个新事项').fill('桌面首屏任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();

  const layout = await page.evaluate(() => {
    const focus = document.querySelector('.today-focus');
    const list = document.querySelector('#today-list');
    const next = document.querySelector('[data-next-action]');
    return {
      display: getComputedStyle(focus).display,
      height: focus.getBoundingClientRect().height,
      listTop: list.getBoundingClientRect().top,
      nextHeight: next.getBoundingClientRect().height,
    };
  });

  expect(layout.display).toBe('grid');
  expect(layout.height).toBeLessThanOrEqual(124);
  expect(layout.nextHeight).toBeLessThanOrEqual(72);
  expect(layout.listTop).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '桌面首屏任务', exact: true })).toBeVisible();
});
