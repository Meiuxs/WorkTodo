import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTheme, THEME_SETTINGS } from '../../src/shared/theme.js';

test('主题解析支持系统偏好和显式选择', () => {
  assert.deepEqual(THEME_SETTINGS, ['system', 'light', 'dark']);
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
});
