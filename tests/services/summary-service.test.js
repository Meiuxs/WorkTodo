import assert from 'node:assert/strict';
import test from 'node:test';

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
  assert.match(summary.text, /- 完成报价/);
  assert.match(summary.text, /- 整理材料/);
  assert.doesNotMatch(summary.text, /https?:\/\//);
  assert.doesNotMatch(summary.text, /<[^>]+>/);
});

test('总结清洗常见链接与 HTML 标签但保留比较表达式', async () => {
  const service = new SummaryService({
    statistics: {
      async weekly() {
        return {
          completedCount: 9,
          plannedCount: 9,
          postponedCount: 0,
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
          { title: 'ftp://files.example.com' },
          { title: 'example.com/path' },
          { title: 'tel:+86-12345678' },
          { title: 'tel:110' },
          { title: 'file:/tmp/private' },
          { title: '192.168.1.10:8080/private' },
          { title: '<b>加粗</b>' },
          { title: '价格 1 < 2 > 0' },
          { title: '版本:1.2.3 与 1.5' },
          { title: '提醒: 明天处理' },
          { title: '文件 example.computer 保留' },
          { title: '  连续\t空白   折叠  ' },
          { title: '' },
          { title: undefined },
        ];
      },
    },
  });

  const summary = await service.weekly('2026-09-17');

  assert.equal((summary.text.match(/\[链接已移除\]/g) ?? []).length, 9);
  assert.doesNotMatch(summary.text, /https:\/\/example\.com\/a/);
  assert.doesNotMatch(summary.text, /www\.example\.com\/private/);
  assert.doesNotMatch(summary.text, /mailto:foo@example\.com/);
  assert.doesNotMatch(summary.text, /ftp:\/\/files\.example\.com/);
  assert.doesNotMatch(summary.text, /example\.com\/path/);
  assert.doesNotMatch(summary.text, /tel:\+86-12345678/);
  assert.doesNotMatch(summary.text, /tel:110/);
  assert.doesNotMatch(summary.text, /file:\/tmp\/private/);
  assert.doesNotMatch(summary.text, /192\.168\.1\.10:8080\/private/);
  assert.doesNotMatch(summary.text, /<\/?b>/);
  assert.match(summary.text, /- 加粗/);
  assert.match(summary.text, /- 价格 1 < 2 > 0/);
  assert.match(summary.text, /- 版本:1\.2\.3 与 1\.5/);
  assert.match(summary.text, /- 提醒: 明天处理/);
  assert.match(summary.text, /- 文件 example\.computer 保留/);
  assert.match(summary.text, /- 连续 空白 折叠/);
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
