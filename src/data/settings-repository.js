function clone(value) {
  return structuredClone(value);
}

function localStorageArea() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    throw new Error('chrome.storage.local 不可用');
  }
  return chrome.storage.local;
}

function assertNoTaskArray(value) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'tasks' && Array.isArray(child)) {
      throw new TypeError('任务数据必须保存到 IndexedDB，不能保存到 chrome.storage.local');
    }
    assertNoTaskArray(child);
  }
}

export class SettingsRepository {
  async getSettings() {
    const { settings } = await localStorageArea().get('settings');
    return settings === undefined ? undefined : clone(settings);
  }

  async saveSettings(settings) {
    const value = clone(settings);
    assertNoTaskArray(value);
    await localStorageArea().set({ settings: value });
    return clone(value);
  }

  async getMetadata() {
    const { metadata } = await localStorageArea().get('metadata');
    return metadata === undefined ? undefined : clone(metadata);
  }

  async saveMetadata(metadata) {
    const value = clone(metadata);
    assertNoTaskArray(value);
    await localStorageArea().set({ metadata: value });
    return clone(value);
  }
}
