import { test, expect, openDashboard, openPopup } from './fixtures.js';

async function readTypography(page) {
  return page.evaluate(() => ({
    micro: getComputedStyle(document.documentElement).getPropertyValue('--fs-micro').trim(),
    weights: [...new Set([...document.querySelectorAll('*')].map((element) => getComputedStyle(element).fontWeight))],
  }));
}

test('渲染字号从 12px 起步且字重只使用 400/700', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  const dashboardTypography = await readTypography(dashboard);
  expect(dashboardTypography.micro).toBe('12px');
  expect(dashboardTypography.weights.every((weight) => ['400', '700'].includes(weight))).toBe(true);

  const popup = await openPopup(extension);
  const popupTypography = await readTypography(popup);
  expect(popupTypography.micro).toBe('12px');
  expect(popupTypography.weights.every((weight) => ['400', '700'].includes(weight))).toBe(true);
});
