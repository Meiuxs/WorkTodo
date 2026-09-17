import { test, expect, openDashboard } from './fixtures.js';

test('本周视图展示今天所在周的计划任务', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('本周计划事项');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();

  await page.getByRole('button', { name: '本周', exact: true }).click();
  await expect(page.locator('#page-title')).toHaveText('本周');
  await expect(page.getByRole('heading', { name: /本周计划/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '本周计划事项' })).toBeVisible();
});

test('快速切换路由时旧周视图不会覆盖当前视图', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.evaluate(async () => {
    const { TaskQueryService } = await import('../services/task-query-service.js');
    const originalWeek = TaskQueryService.prototype.week;
    TaskQueryService.prototype.week = async function delayedWeek(anchorDate) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return originalWeek.call(this, anchorDate);
    };
  });

  await page.getByRole('button', { name: '本周', exact: true }).click();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.waitForTimeout(400);

  await expect(page.locator('#page-title')).toHaveText('今日工作');
  await expect(page.locator('#today-tasks-heading')).toBeVisible();
  await expect(page.locator('#week-heading')).toHaveCount(0);
});

test('永不结束的旧周视图不会阻塞最新导航', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.evaluate(async () => {
    const { TaskQueryService } = await import('../services/task-query-service.js');
    TaskQueryService.prototype.week = () => new Promise(() => {});
  });

  await page.getByRole('button', { name: '本周', exact: true }).click();
  await page.getByRole('button', { name: '今天', exact: true }).click();

  await expect(page.locator('#today-tasks-heading')).toBeVisible({ timeout: 1_000 });
  await expect(page.locator('#week-heading')).toHaveCount(0);
});
