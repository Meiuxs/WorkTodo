export function generateId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID 不可用，无法生成任务 ID');
  }
  return globalThis.crypto.randomUUID();
}
