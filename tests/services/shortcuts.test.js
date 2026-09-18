import assert from 'node:assert/strict';
import test from 'node:test';
import { createShortcutHandler } from '../../src/dashboard/shortcuts.js';

function keyEvent(key, target = { tagName: 'BODY' }) {
  return {
    key,
    target,
    preventDefault() { this.prevented = true; },
    prevented: false,
  };
}

test('页面快捷键导航并聚焦快速新增与搜索', () => {
  const calls = [];
  const handler = createShortcutHandler({
    navigate: (route) => calls.push(['navigate', route]),
    focusQuickAdd: () => calls.push(['focus', 'quick-add']),
    focusSearch: () => calls.push(['focus', 'search']),
  });

  for (const [key, expected] of [['n', ['focus', 'quick-add']], ['f', ['focus', 'search']], ['t', ['navigate', 'today']], ['w', ['navigate', 'week']], ['m', ['navigate', 'month']]]) {
    const event = keyEvent(key);
    handler(event);
    assert.deepEqual(calls.at(-1), expected);
    assert.equal(event.prevented, true);
  }
});

test('输入框和可编辑目标内不触发页面快捷键', () => {
  const calls = [];
  const handler = createShortcutHandler({
    navigate: (route) => calls.push(route),
    focusQuickAdd: () => calls.push('quick-add'),
    focusSearch: () => calls.push('search'),
  });

  handler(keyEvent('n', { tagName: 'INPUT' }));
  handler(keyEvent('w', { tagName: 'TEXTAREA' }));
  handler(keyEvent('m', { tagName: 'SELECT' }));
  assert.deepEqual(calls, []);
});
