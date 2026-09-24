import { applyTheme } from '../shared/theme.js';

chrome.storage.local.get('settings')
  .then(({ settings }) => applyTheme(settings?.theme ?? 'system'))
  .catch(() => applyTheme('system'));
