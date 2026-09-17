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

test('月历展示当前月份任务并支持切换月份', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('月历任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();

  await page.getByRole('button', { name: '月历', exact: true }).click();
  await expect(page.locator('#page-title')).toHaveText('月历');
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('button', { name: '月历任务', exact: true })).toBeVisible();
  const currentMonth = await page.locator('[data-month-label]').textContent();
  await page.getByRole('button', { name: '下个月', exact: true }).click();
  await expect(page.locator('[data-month-label]')).not.toHaveText(currentMonth);
});

test('月历在 390px 下可键盘打开任务且没有横向溢出', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('记录一个新事项').fill('键盘月历任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();

  await page.getByRole('button', { name: '月历', exact: true }).click();
  await expect(page.locator('[data-month-label]')).toBeVisible();
  await expect(page.locator('.month-day .task__status')).toBeVisible();

  const taskButton = page.getByRole('button', { name: '键盘月历任务', exact: true });
  await taskButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#task-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(taskButton).toBeFocused();

  const layout = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.month-week')];
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      cellCounts: rows.map((row) => row.children.length),
      columnCounts: rows.map((row) => getComputedStyle(row).gridTemplateColumns.split(' ').length),
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.cellCounts.every((count) => count === 7)).toBe(true);
  expect(layout.columnCounts.every((count) => count === 7)).toBe(true);
});

test('月历连续切换月份时旧请求不会覆盖最新月份', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByRole('button', { name: '月历', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();

  const initialMonth = await page.locator('[data-month-label]').textContent();
  const expectedMonth = await page.evaluate((label) => {
    const match = label.match(/(\d{4})年(\d{1,2})月/);
    if (match === null) throw new Error(`无法解析月份: ${label}`);
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' })
      .format(new Date(Number(match[1]), Number(match[2]) - 1 + 2, 1));
  }, initialMonth);

  await page.evaluate(async () => {
    window.__monthQueryResults = [];
    const { TaskQueryService } = await import('../services/task-query-service.js');
    const originalMonth = TaskQueryService.prototype.month;
    let callCount = 0;
    TaskQueryService.prototype.month = async function delayedMonth(anchorDate) {
      const call = ++callCount;
      const delay = call === 1 ? 500 : call === 2 ? 25 : 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      const result = await originalMonth.call(this, anchorDate);
      window.__monthQueryResults.push({ call, month: anchorDate.slice(0, 7) });
      return result;
    };
  });

  const nextMonth = page.getByRole('button', { name: '下个月', exact: true });
  await nextMonth.click();
  await nextMonth.click();
  await expect.poll(() => page.evaluate(() => window.__monthQueryResults.length)).toBe(2);

  await expect(page.locator('[data-month-label]')).toHaveText(expectedMonth);
});

test('月历旧月份请求失败时静默丢弃', async ({ extension }) => {
  const page = await openDashboard(extension);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.getByRole('button', { name: '月历', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();

  await page.evaluate(async () => {
    window.__planningErrors = [];
    window.__monthQueryState = { failures: 0, successes: 0 };
    window.addEventListener('unhandledrejection', (event) => {
      window.__planningErrors.push(event.reason?.message ?? String(event.reason));
    });
    const { TaskQueryService } = await import('../services/task-query-service.js');
    const originalMonth = TaskQueryService.prototype.month;
    let callCount = 0;
    TaskQueryService.prototype.month = async function delayedMonth(anchorDate) {
      const call = ++callCount;
      await new Promise((resolve) => setTimeout(resolve, call === 1 ? 500 : 25));
      if (call === 1) {
        window.__monthQueryState.failures += 1;
        throw new Error('旧月份查询失败');
      }
      const result = await originalMonth.call(this, anchorDate);
      window.__monthQueryState.successes += 1;
      return result;
    };
  });

  const nextMonth = page.getByRole('button', { name: '下个月', exact: true });
  await nextMonth.click();
  await nextMonth.click();
  await expect.poll(() => page.evaluate(() => (
    window.__monthQueryState.failures === 1 && window.__monthQueryState.successes === 1
  ))).toBe(true);
  await page.waitForTimeout(50);

  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => window.__planningErrors)).toEqual([]);
  expect(await page.locator('#toast').evaluate((element) => element.hidden)).toBe(true);
});

test('工作记录可以生成并复制规则模板总结', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('总结用任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('checkbox', { name: '完成任务', exact: true }).first().click();
  await page.getByRole('button', { name: '工作记录', exact: true }).click();

  await expect(page.getByRole('button', { name: '生成本周总结', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成本月总结', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '生成本周总结', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '总结文本' })).toHaveValue(/实际完成/);
  await expect(page.getByRole('textbox', { name: '总结文本' })).toHaveValue(/总结用任务/);

  await page.evaluate(() => {
    window.__copiedSummary = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copiedSummary = text;
        },
        readText: async () => {
          throw new Error('不应读取剪贴板');
        },
      },
    });
  });
  await page.getByRole('button', { name: '复制总结', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__copiedSummary)).toContain('实际完成');
  await expect.poll(() => page.evaluate(() => window.__copiedSummary)).toContain('总结用任务');
});

test('较慢的旧总结请求不会覆盖新总结', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByRole('button', { name: '工作记录', exact: true }).click();
  await page.evaluate(async () => {
    const { SummaryService } = await import('../services/summary-service.js');
    const originalWeekly = SummaryService.prototype.weekly;
    const originalMonthly = SummaryService.prototype.monthly;
    SummaryService.prototype.weekly = async function delayedWeekly(anchorDate) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return originalWeekly.call(this, anchorDate);
    };
    SummaryService.prototype.monthly = async function delayedMonthly(anchorDate) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return originalMonthly.call(this, anchorDate);
    };
  });

  await page.getByRole('button', { name: '生成本周总结', exact: true }).click();
  await page.getByRole('button', { name: '生成本月总结', exact: true }).click();

  const output = page.getByRole('textbox', { name: '总结文本' });
  await expect(output).toHaveValue(/本月总结/);
  await page.waitForTimeout(350);
  await expect(output).toHaveValue(/本月总结/);
  await expect(output).not.toHaveValue(/本周总结/);
});

test('总结面板在 390px 下可键盘生成且没有横向溢出', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '工作记录', exact: true }).click();

  const generate = page.getByRole('button', { name: '生成本周总结', exact: true });
  await generate.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: '总结文本' })).toHaveValue(/实际完成/);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
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

test('工作记录迟到的普通错误不会形成未处理 rejection', async ({ extension }) => {
  const page = await openDashboard(extension);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.evaluate(async () => {
    window.__planningErrors = [];
    window.addEventListener('unhandledrejection', (event) => {
      window.__planningErrors.push(event.reason?.message ?? String(event.reason));
    });
    const { StatisticsService } = await import('../services/statistics-service.js');
    StatisticsService.prototype.weekly = async function lateFailure() {
      await new Promise((resolve) => setTimeout(resolve, 300));
      throw new Error('late history failure');
    };
  });

  await page.getByRole('button', { name: '工作记录', exact: true }).click();
  await expect(page.locator('#history-heading')).toBeVisible();
  await page.getByRole('button', { name: '按周', exact: true }).click();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.waitForTimeout(450);

  await expect(page.locator('#today-tasks-heading')).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => window.__planningErrors)).toEqual([]);
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

test('全部任务 timer 的迟到普通错误不会形成未处理 rejection', async ({ extension }) => {
  const page = await openDashboard(extension);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.evaluate(async () => {
    window.__planningErrors = [];
    window.addEventListener('unhandledrejection', (event) => {
      window.__planningErrors.push(event.reason?.message ?? String(event.reason));
    });
    const { TaskQueryService } = await import('../services/task-query-service.js');
    TaskQueryService.prototype.search = async function lateFailure() {
      await new Promise((resolve) => setTimeout(resolve, 250));
      throw new Error('late search failure');
    };
  });

  await page.getByRole('button', { name: '全部任务', exact: true }).click();
  await page.getByLabel('搜索').fill('迟到错误');
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
