import assert from 'node:assert/strict';
import test from 'node:test';

import { CsvExportService } from '../../src/services/csv-service.js';

test('CSV 导出包含分类和标签文本并转义引号与公式字符', () => {
  const service = new CsvExportService();
  const csv = service.createCsv({
    tasks: [{
      id: 't1', title: '=SUM(A1:A2)', lifecycle: 'todo', priority: 'high',
      categoryId: 'c1', tagIds: ['tag1'], scheduledDate: '2026-09-17',
      startTime: '09:00', dueTime: '10:00', completedAt: null,
      createdAt: '2026-09-17T08:00:00.000Z',
    }],
    categories: [{ id: 'c1', name: '客户' }],
    tags: [{ id: 'tag1', name: '报价' }],
  });

  assert.match(csv, /^﻿/);
  assert.match(csv, /客户/);
  assert.match(csv, /报价/);
  assert.match(csv, /'=SUM/);
});
