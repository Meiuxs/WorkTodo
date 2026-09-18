import assert from 'node:assert/strict';
import test from 'node:test';

import { createNavBadges } from '../../src/dashboard/nav-badges.js';

const SELECTOR = /^\[data-nav-badge(-desc)?="([^"]+)"\]$/;

// 角标模块只依赖 querySelector，用最小替身就能锁住"数量 -> 文本 / 可见性 / 读屏描述"的映射。
function createContainer() {
  const nodes = new Map();
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, { textContent: '', hidden: true });
    return nodes.get(key);
  }
  return {
    node,
    querySelector(selector) {
      const match = SELECTOR.exec(selector);
      if (match === null) return null;
      return node(`${match[1] === '-desc' ? 'desc' : 'badge'}:${match[2]}`);
    },
  };
}

test('数量为 0 时隐藏角标并清空读屏描述', async () => {
  const container = createContainer();
  const badges = createNavBadges({
    container,
    query: { overdue: async () => [], inbox: async () => [] },
    today: () => '2026-09-19',
  });

  await badges.refresh();

  assert.equal(container.node('badge:today').hidden, true);
  assert.equal(container.node('badge:today').textContent, '');
  assert.equal(container.node('desc:today').textContent, '');
  assert.equal(container.node('badge:inbox').hidden, true);
  assert.equal(container.node('desc:inbox').textContent, '');
});

test('角标显示逾期与待整理数量并把同一句话交给读屏', async () => {
  const container = createContainer();
  const seenDates = [];
  const badges = createNavBadges({
    container,
    query: {
      overdue: async (date) => {
        seenDates.push(date);
        return [{ id: 'a' }, { id: 'b' }];
      },
      inbox: async () => [{ id: 'c' }],
    },
    today: () => '2026-09-19',
  });

  await badges.refresh();

  assert.deepEqual(seenDates, ['2026-09-19']);
  assert.equal(container.node('badge:today').textContent, '2');
  assert.equal(container.node('badge:today').hidden, false);
  assert.equal(container.node('desc:today').textContent, '2 项逾期待处理');
  assert.equal(container.node('badge:inbox').textContent, '1');
  assert.equal(container.node('badge:inbox').hidden, false);
  assert.equal(container.node('desc:inbox').textContent, '1 项待整理');
});
