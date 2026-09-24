export async function broadcastTaskChanged({ taskId }, runtime = chrome.runtime) {
  await runtime.sendMessage({ type: 'TASK_CHANGED', taskId });
}

export async function openWelcomeOnFirstInstall(details, { runtime, tabs }) {
  if (details?.reason !== 'install') return false;
  try {
    await tabs.create({ url: runtime.getURL('src/welcome/index.html') });
    return true;
  } catch {
    // 安装引导是可选帮助；打开失败不能影响扩展本身初始化。
    return false;
  }
}

if (typeof chrome !== 'undefined') {
  chrome.runtime.onInstalled.addListener((details) => {
    void openWelcomeOnFirstInstall(details, chrome);
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'TASK_CHANGED') return false;
    return false;
  });
}
