import assert from 'node:assert/strict';
import test from 'node:test';

import { CsvExportService } from '../../src/services/csv-service.js';

const HEADER = '"标题","状态","优先级","分类","标签","计划日期","开始时间","截止时间","完成时间","创建时间"';
const CREATED_AT = '2026-09-17T08:00:00.000Z';

function task(overrides = {}) {
  return {
    title: '任务',
    lifecycle: 'todo',
    priority: 'high',
    categoryId: null,
    tagIds: [],
    scheduledDate: null,
    startTime: null,
    dueTime: null,
    completedAt: null,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function expectedRow(title) {
  return `${title},"todo","high","","","","","","","${CREATED_AT}"`;
}

test('CSV 导出包含 BOM、固定列顺序和 CRLF', () => {
  const service = new CsvExportService();
  const csv = service.createCsv({ tasks: [], categories: [], tags: [] });

  assert.equal(csv, `\uFEFF${HEADER}\r\n`);
});

test('CSV 导出转义双引号并为四种公式前缀增加单引号', () => {
  const service = new CsvExportService();
  const cases = [
    ['A"B', '"A""B"'],
    ['=SUM(A1:A2)', '"\'=SUM(A1:A2)"'],
    ['+SUM(A1:A2)', '"\'+SUM(A1:A2)"'],
    ['-1+1', '"\'-1+1"'],
    ['@SUM(A1:A2)', '"\'@SUM(A1:A2)"'],
  ];
  const csv = service.createCsv({
    tasks: cases.map(([title]) => task({ title })),
    categories: [],
    tags: [],
  });
  const rows = csv.slice(1).split('\r\n');

  assert.equal(rows[0], HEADER);
  for (const [index, [, expectedTitle]] of cases.entries()) {
    assert.equal(rows[index + 1], expectedRow(expectedTitle));
  }
});

test('CSV 导出分类和标签名称且忽略无法解析的关系 ID', () => {
  const service = new CsvExportService();
  const csv = service.createCsv({
    tasks: [task({ categoryId: 'c1', tagIds: ['tag1', 'missing', 'tag2'] })],
    categories: [{ id: 'c1', name: '客户' }],
    tags: [
      { id: 'tag1', name: '报价' },
      { id: 'tag2', name: '重点' },
    ],
  });
  const rows = csv.slice(1).split('\r\n');

  assert.equal(rows[1], `"任务","todo","high","客户","报价 重点","","","","","${CREATED_AT}"`);
});

test('CSV 将 null 和 undefined 导出为空单元格', () => {
  const service = new CsvExportService();
  const csv = service.createCsv({
    tasks: [
      task(),
      task({
        title: 'undefined',
        categoryId: undefined,
        tagIds: undefined,
        scheduledDate: undefined,
        startTime: undefined,
        dueTime: undefined,
        completedAt: undefined,
      }),
    ],
    categories: [],
    tags: [],
  });
  const rows = csv.slice(1).split('\r\n');

  assert.equal(rows[1], expectedRow('"任务"'));
  assert.equal(rows[2], expectedRow('"undefined"'));
});
