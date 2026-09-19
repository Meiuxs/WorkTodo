import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  DEFAULT_ROUTE,
  readFilters,
  readHistoryState,
  readRoute,
  writeParams,
  writeRoute,
} from '../../src/dashboard/hash.js';

/* 用内存版 location/history 模拟浏览器：replaceState 只改写 hash，不入历史栈。 */
let currentHash = '';
const originalLocation = globalThis.location;
const originalHistory = globalThis.history;

function installBrowserStub() {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      get hash() {
        return currentHash;
      },
      set hash(value) {
        currentHash = value.startsWith('#') ? value : `#${value}`;
      },
    },
  });
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: {
      replaceState(_state, _title, url) {
        currentHash = String(url);
      },
    },
  });
}

afterEach(() => {
  currentHash = '';
  Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation });
  Object.defineProperty(globalThis, 'history', { configurable: true, value: originalHistory });
});

test('readRoute 从 #/route 解析路由，忽略查询段', async () => {
  installBrowserStub();
  currentHash = '#/week?text=abc';
  assert.equal(readRoute(), 'week');
  assert.equal(DEFAULT_ROUTE, 'today');
});

test('无 history 栈的环境里写入是空操作、读取回退默认值', async () => {
  Object.defineProperty(globalThis, 'history', { configurable: true, value: undefined });
  assert.equal(readRoute(), '');
  assert.doesNotThrow(() => writeRoute('today'));
  assert.doesNotThrow(() => writeParams({ text: 'x' }));
});

test('writeRoute 保留查询段，writeParams 保留路径', async () => {
  installBrowserStub();
  writeRoute('all');
  assert.equal(currentHash, '#/all');
  writeParams({ text: '报价', lifecycle: 'todo' });
  assert.equal(currentHash, '#/all?text=%E6%8A%A5%E4%BB%B7&lifecycle=todo');
  writeRoute('today');
  assert.equal(currentHash, '#/today?text=%E6%8A%A5%E4%BB%B7&lifecycle=todo');
  assert.equal(readRoute(), 'today');
});

test('readFilters 只挑白名单键并跳过空值', async () => {
  installBrowserStub();
  currentHash = '#/all?text=%E6%8A%A5%E4%BB%B7&lifecycle=todo&evil=1&priority=&starred=true';
  assert.deepEqual(readFilters(), { text: '报价', lifecycle: 'todo', starred: 'true' });
});

test('readHistoryState 解析记录模式与日期', async () => {
  installBrowserStub();
  currentHash = '#/history?mode=weekly&date=2026-09-14&noise=x';
  assert.deepEqual(readHistoryState(), { mode: 'weekly', date: '2026-09-14' });
  currentHash = '#/history';
  assert.deepEqual(readHistoryState(), {});
});

test('writeParams 丢弃空值键，目标 hash 相同时不重复写入', async () => {
  installBrowserStub();
  let replaceCount = 0;
  globalThis.history.replaceState = (_state, _title, url) => {
    replaceCount += 1;
    currentHash = String(url);
  };
  writeParams({ mode: 'daily', date: '', noise: null });
  assert.equal(currentHash, '#/today?mode=daily');
  assert.equal(replaceCount, 1);
  writeParams({ mode: 'daily' });
  assert.equal(replaceCount, 1);
});
