import assert from 'node:assert/strict';
import test from 'node:test';

import { createHistoryView } from '../../src/dashboard/views/history-view.js';
import { StatisticsService } from '../../src/services/statistics-service.js';
import { SummaryService } from '../../src/services/summary-service.js';
import { InMemoryTaskRepository } from '../helpers/fakes.js';

const NOW = '2026-09-17T08:30:00.000Z';

function task(overrides = {}) {
  const scheduledDate = overrides.scheduledDate ?? '2026-09-17';
  return {
    id: 'task',
    title: '任务',
    description: '',
    priority: 'none',
    starred: false,
    categoryId: null,
    scheduledDate,
    firstScheduledDate: scheduledDate,
    startTime: null,
    dueTime: null,
    lifecycle: 'todo',
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    cancelledAt: null,
    trashedAt: null,
    ...overrides,
  };
}

function localNoon(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12).toISOString();
}

test('周总结只使用本地统计和已完成任务标题', async () => {
  const service = new SummaryService({
    statistics: {
      async weekly() {
        return {
          completedCount: 2,
          plannedCount: 3,
          postponedCount: 1,
          plannedCompletedCount: 2,
          carriedOverCompletedCount: 1,
          completionRate: 2 / 3,
        };
      },
    },
    query: {
      async completed() {
        return [{ title: '完成报价' }, { title: '整理材料' }];
      },
    },
  });

  const summary = await service.weekly('2026-09-17');

  assert.equal(summary.kind, 'week');
  assert.equal(summary.title, '本周总结');
  assert.equal(summary.rangeText, '2026-09-14 至 2026-09-20');
  assert.match(summary.text, /实际完成 2 项/);
  assert.match(summary.text, /计划任务 3 项/);
  assert.match(summary.text, /延期 1 次/);
  assert.match(summary.text, /完成率 67%/);
  assert.match(summary.text, /计划并完成 2 项，历史延期完成 1 项。/);
  assert.match(summary.text, /- 完成报价/);
  assert.match(summary.text, /- 整理材料/);
});

test('总结标题只折叠空白并原样保留用户文本', async () => {
  const service = new SummaryService({
    statistics: {
      async weekly() {
        return {
          completedCount: 12,
          plannedCount: 12,
          postponedCount: 0,
          plannedCompletedCount: 12,
          carriedOverCompletedCount: 0,
          completionRate: 1,
        };
      },
    },
    query: {
      async completed() {
        return [
          { title: 'https://example.com/a' },
          { title: 'www.example.com/private' },
          { title: 'mailto:foo@example.com' },
          { title: '<b>加粗</b>' },
          { title: '价格 1 < 2 > 0' },
          { title: String.raw`C:\Users\alice\secret.txt` },
          { title: '/home/alice/secret.txt' },
          { title: 'note:明天处理' },
          { title: '第一行\n第二行\t第三行' },
          { title: '  连续\t空白   折叠  ' },
          { title: '' },
          { title: undefined },
        ];
      },
    },
  });

  const summary = await service.weekly('2026-09-17');

  assert.doesNotMatch(summary.text, /\[链接已移除\]/);
  assert.ok(summary.text.includes('- https://example.com/a'));
  assert.ok(summary.text.includes('- www.example.com/private'));
  assert.ok(summary.text.includes('- mailto:foo@example.com'));
  assert.ok(summary.text.includes('- <b>加粗</b>'));
  assert.ok(summary.text.includes('- 价格 1 < 2 > 0'));
  assert.ok(summary.text.includes(String.raw`- C:\Users\alice\secret.txt`));
  assert.ok(summary.text.includes('- /home/alice/secret.txt'));
  assert.ok(summary.text.includes('- note:明天处理'));
  assert.ok(summary.text.includes('- 第一行 第二行 第三行'));
  assert.ok(summary.text.includes('- 连续 空白 折叠'));
  assert.equal((summary.text.match(/- 未命名任务/g) ?? []).length, 2);
});

test('月总结使用本地整月边界且没有计划时显示暂无计划', async () => {
  const calls = [];
  const service = new SummaryService({
    statistics: {
      async monthly(anchorDate) {
        calls.push(['statistics', anchorDate]);
        return {
          completedCount: 0,
          plannedCount: 0,
          postponedCount: 0,
          plannedCompletedCount: 0,
          carriedOverCompletedCount: 0,
          completionRate: null,
        };
      },
    },
    query: {
      async completed(filters) {
        calls.push(['query', filters]);
        return [];
      },
    },
  });

  const summary = await service.monthly('2026-09-17');

  assert.equal(summary.kind, 'month');
  assert.equal(summary.title, '本月总结');
  assert.equal(summary.rangeText, '2026-09-01 至 2026-09-30');
  assert.match(summary.text, /完成率 暂无计划/);
  assert.match(summary.text, /计划并完成 0 项，历史延期完成 0 项。/);
  assert.match(summary.text, /- 暂无/);
  assert.deepEqual(calls, [
    ['statistics', '2026-09-17'],
    ['query', { completedFrom: '2026-09-01', completedTo: '2026-09-30' }],
  ]);
});

test('StatisticsService.monthly 按本地日历整月聚合', async () => {
  const statistics = new StatisticsService(new InMemoryTaskRepository([
    task({
      id: 'first-day',
      scheduledDate: '2026-09-01',
      lifecycle: 'completed',
      completedAt: localNoon('2026-09-01'),
    }),
    task({
      id: 'last-day',
      scheduledDate: '2026-09-30',
      lifecycle: 'completed',
      completedAt: localNoon('2026-09-30'),
    }),
    task({
      id: 'previous-month',
      scheduledDate: '2026-08-31',
      lifecycle: 'completed',
      completedAt: localNoon('2026-08-31'),
    }),
    task({
      id: 'next-month',
      scheduledDate: '2026-10-01',
      lifecycle: 'completed',
      completedAt: localNoon('2026-10-01'),
    }),
  ]));

  const monthly = await statistics.monthly('2026-09-17');

  assert.equal(monthly.completedCount, 2);
  assert.equal(monthly.plannedCount, 2);
  assert.equal(monthly.completionRate, 1);
  assert.equal(monthly.plannedCompletedCount, 2);
  assert.equal(monthly.carriedOverCompletedCount, 0);
});

test('copyText 只写入剪贴板且不读取', async () => {
  const service = new SummaryService({ statistics: {}, query: {} });
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const writes = [];

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        async writeText(text) {
          writes.push(text);
        },
        async readText() {
          throw new Error('不应读取剪贴板');
        },
      },
    },
  });

  try {
    await service.copyText('本周总结');
    assert.deepEqual(writes, ['本周总结']);
  } finally {
    if (originalNavigator === undefined) {
      delete globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    }
  }
});

function createHistoryRoot() {
  const elements = new Map();
  const listeners = new Map();
  const modeButtons = ['daily', 'weekly'].map((historyMode) => {
    const button = {
      dataset: { historyMode },
      addEventListener(type, listener) {
        listeners.set(`mode:${historyMode}:${type}`, listener);
      },
    };
    return button;
  });
  const root = {
    innerHTML: '',
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, {
          innerHTML: '',
          value: '',
          disabled: false,
          addEventListener(type, listener) {
            listeners.set(`${selector}:${type}`, listener);
          },
        });
      }
      return elements.get(selector);
    },
    querySelectorAll(selector) {
      return selector === '[data-history-mode]' ? modeButtons : [];
    },
  };
  return { root, listeners };
}

test('History 视图在日模式和周模式显示新增指标标签', async () => {
  const calls = [];
  const { root, listeners } = createHistoryRoot();
  const statistics = {
    async daily(date) {
      calls.push(['daily', date]);
      return {
        completedCount: 4,
        plannedCount: 5,
        createdCount: 3,
        postponedCount: 1,
        completionRate: 0.8,
        plannedCompletedCount: 7,
        carriedOverCompletedCount: 2,
      };
    },
    async weekly(weekStart) {
      calls.push(['weekly', weekStart]);
      return {
        completedCount: 8,
        plannedCount: 9,
        createdCount: 6,
        postponedCount: 3,
        completionRate: 8 / 9,
        plannedCompletedCount: 11,
        carriedOverCompletedCount: 4,
      };
    },
    async weeklyDaily() {
      return [
        '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17',
        '2026-09-18', '2026-09-19', '2026-09-20',
      ].map((date) => ({
        date,
        completedCount: 1,
        plannedCount: 1,
        postponedCount: 0,
      }));
    },
  };
  const view = createHistoryView({
    root,
    query: { async completed() { return []; } },
    statistics,
    summaryService: {},
    today: () => '2026-09-17',
    onAction() {},
    onEdit() {},
  });

  await view.render();

  assert.deepEqual(calls, [['weekly', '2026-09-14']]);
  assert.match(root.innerHTML, /class="history-report-top"/);
  assert.match(root.innerHTML, /class="history-insight"/);
  assert.match(root.innerHTML, /class="history-rate"/);
  assert.match(root.innerHTML, /class="metrics report-metrics"/);
  assert.match(root.innerHTML, /class="history-breakdown"/);
  assert.match(root.innerHTML, /<dt>实际完成<\/dt>/);
  assert.match(root.innerHTML, /<dt>计划任务<\/dt>/);
  assert.match(root.innerHTML, /<dt>新增任务<\/dt>/);
  assert.match(root.innerHTML, /<dt>延期次数<\/dt>/);
  assert.match(root.innerHTML, /<dt>完成率<\/dt>/);
  assert.match(root.innerHTML, /<dt>本周计划并完成<\/dt><dd>11<\/dd>/);
  assert.match(root.innerHTML, /<dt>历史延期到本周完成<\/dt><dd>4<\/dd>/);

  await listeners.get('mode:daily:click')();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [
    ['weekly', '2026-09-14'],
    ['daily', '2026-09-17'],
  ]);
  assert.match(root.innerHTML, /<dt>计划并完成<\/dt><dd>7<\/dd>/);
  assert.match(root.innerHTML, /<dt>历史延期完成<\/dt><dd>2<\/dd>/);
});

test('History 视图在没有计划时不把完成率读成 0%', async () => {
  const { root, listeners } = createHistoryRoot();
  const emptySummary = {
    completedCount: 0,
    plannedCount: 0,
    createdCount: 0,
    postponedCount: 0,
    completionRate: null,
    plannedCompletedCount: 0,
    carriedOverCompletedCount: 0,
  };
  const view = createHistoryView({
    root,
    query: { async completed() { return []; } },
    statistics: {
      async weekly() { return emptySummary; },
      async weeklyDaily() { return []; },
      async daily() { return emptySummary; },
    },
    summaryService: {},
    today: () => '2026-09-17',
    onAction() {},
    onEdit() {},
  });

  await view.render();
  await listeners.get('mode:daily:click')();
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(root.innerHTML, /aria-label="完成率暂无计划"/);
  assert.match(root.innerHTML, /<div class="history-rate__value">—<\/div>/);
  assert.match(root.innerHTML, /<span>暂无计划<\/span>/);
});

test('History 视图默认按周显示七天真实完成节奏', async () => {
  const { root } = createHistoryRoot();
  const view = createHistoryView({
    root,
    query: { async completed() { return []; } },
    statistics: {
      async weekly() {
        return {
          completedCount: 2,
          plannedCount: 3,
          createdCount: 2,
          postponedCount: 1,
          completionRate: 2 / 3,
          plannedCompletedCount: 2,
          carriedOverCompletedCount: 0,
        };
      },
      async weeklyDaily() {
        return [
          '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17',
          '2026-09-18', '2026-09-19', '2026-09-20',
        ].map((date, index) => ({
          date,
          completedCount: index === 3 ? 2 : 0,
          plannedCount: index === 3 ? 3 : 0,
          postponedCount: index === 3 ? 1 : 0,
        }));
      },
    },
    summaryService: {},
    today: () => '2026-09-17',
    onAction() {},
    onEdit() {},
  });

  await view.render();

  assert.match(root.innerHTML, /aria-label="本周每日完成量"/);
  assert.equal((root.innerHTML.match(/class="history-day(?: |")/g) ?? []).length, 7);
  assert.match(root.innerHTML, /class="history-day history-day--today(?: |\")/);
  assert.match(root.innerHTML, /<strong>2<\/strong>/);
  assert.match(root.innerHTML, /role="list"/);
  assert.match(root.innerHTML, /role="listitem"/);
  assert.match(root.innerHTML, /class="history-day__status">延期 1 次<\/small>/);
});

test('History 视图资源统计迟到后不会覆盖最新渲染', async () => {
  const { root } = createHistoryRoot();
  let releaseFirst;
  let firstStartedResolve;
  const firstStarted = new Promise((resolve) => { firstStartedResolve = resolve; });
  const firstCounts = new Promise((resolve) => { releaseFirst = resolve; });
  let weeklyCalls = 0;
  let resourceCalls = 0;
  const view = createHistoryView({
    root,
    query: { async completed() { return []; } },
    statistics: {
      async weekly() {
        weeklyCalls += 1;
        return {
          completedCount: weeklyCalls,
          plannedCount: 1,
          createdCount: 0,
          postponedCount: 0,
          completionRate: 1,
          plannedCompletedCount: weeklyCalls,
          carriedOverCompletedCount: 0,
        };
      },
    },
    summaryService: {},
    today: () => '2026-09-17',
    onAction() {},
    onEdit() {},
    getResourceCounts: async () => {
      resourceCalls += 1;
      if (resourceCalls === 1) {
        firstStartedResolve();
        return firstCounts;
      }
      return new Map();
    },
  });

  const firstRender = view.render();
  await firstStarted;
  await view.render();
  releaseFirst(new Map());
  await firstRender;

  assert.match(root.innerHTML, /已完成 2 项/);
  assert.doesNotMatch(root.innerHTML, /已完成 1 项/);
});
