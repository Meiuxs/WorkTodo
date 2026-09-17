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

test('工作记录延迟切换不会覆盖最新导航', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.evaluate(async () => {
    const { StatisticsService } = await import('../services/statistics-service.js');
    const originalWeekly = StatisticsService.prototype.weekly;
    StatisticsService.prototype.weekly = async function delayedWeekly(anchorDate) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return originalWeekly.call(this, anchorDate);
    };
  });

  await page.getByRole('button', { name: '工作记录', exact: true }).click();
  await expect(page.locator('#history-heading')).toBeVisible();
  await page.getByRole('button', { name: '按周', exact: true }).click();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.waitForTimeout(450);

  await expect(page.locator('#page-title')).toHaveText('今日工作');
  await expect(page.locator('#today-tasks-heading')).toBeVisible();
  await expect(page.locator('#history-heading')).toHaveCount(0);
});

test('延迟搜索返回后不会写入已离开的全部任务视图', async ({ extension }) => {
  const page = await openDashboard(extension);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.evaluate(async () => {
    window.__planningErrors = [];
    window.addEventListener('unhandledrejection', (event) => {
      window.__planningErrors.push(event.reason?.message ?? String(event.reason));
    });
    const { TaskQueryService } = await import('../services/task-query-service.js');
    const originalSearch = TaskQueryService.prototype.search;
    TaskQueryService.prototype.search = async function delayedSearch(filters) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return originalSearch.call(this, filters);
    };
  });

  await page.getByRole('button', { name: '全部任务', exact: true }).click();
  await page.getByLabel('搜索').fill('延迟搜索');
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.waitForTimeout(400);

  await expect(page.locator('#today-tasks-heading')).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => window.__planningErrors)).toEqual([]);
});

test('导航后已发起的导出仍然完成下载', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.evaluate(async () => {
    window.__downloads = [];
    HTMLAnchorElement.prototype.click = function recordDownload() {
      if (this.download.length > 0) window.__downloads.push(this.download);
    };
    const { BackupService } = await import('../services/backup-service.js');
    const originalCreateBackup = BackupService.prototype.createBackup;
    BackupService.prototype.createBackup = async function delayedBackup() {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return originalCreateBackup.call(this);
    };
  });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('#data-management-heading')).toBeVisible();
  await page.getByRole('button', { name: '导出 JSON 备份', exact: true }).click();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.waitForTimeout(400);

  expect(await page.evaluate(() => window.__downloads)).toHaveLength(1);
  await expect(page.locator('#today-tasks-heading')).toBeVisible();
});

test('导航后完成的分类变更仍刷新当前路由', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.evaluate(async () => {
    window.__dataRefreshes = 0;
    const { DashboardController } = await import('./dashboard-controller.js');
    const originalRefresh = DashboardController.prototype.refresh;
    DashboardController.prototype.refresh = async function trackedRefresh() {
      window.__dataRefreshes += 1;
      return originalRefresh.call(this);
    };
    const { TaskService } = await import('../services/task-service.js');
    const originalCreateCategory = TaskService.prototype.createCategory;
    TaskService.prototype.createCategory = async function delayedCategory(name) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return originalCreateCategory.call(this, name);
    };
  });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('新分类名称').fill('导航刷新分类');
  await page.getByRole('button', { name: '创建分类', exact: true }).click();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.waitForTimeout(400);

  expect(await page.evaluate(() => window.__dataRefreshes)).toBeGreaterThan(0);
  await expect(page.locator('#today-tasks-heading')).toBeVisible();
});
