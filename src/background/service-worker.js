export async function broadcastTaskChanged({ taskId }, runtime = chrome.runtime) {
  await runtime.sendMessage({ type: 'TASK_CHANGED', taskId });
}

if (typeof chrome !== 'undefined') {
  chrome.runtime.onInstalled.addListener(() => {});
}
