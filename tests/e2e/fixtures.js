import { test as base, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function launchOptions(extensionPath) {
  const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
  return {
    headless: process.env.HEADLESS_EXTENSION !== 'false',
    ...(process.env.CHROME_PATH === undefined
      ? channel === undefined ? {} : { channel }
      : { executablePath: process.env.CHROME_PATH }),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  };
}

export async function launchExtension({
  extensionPath = projectRoot,
  userDataDir,
  videoDir,
  trace = false,
} = {}) {
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...launchOptions(extensionPath),
    ...(videoDir === undefined ? {} : { recordVideo: { dir: videoDir } }),
  });
  const externalRequests = [];
  context.on('request', (request) => {
    if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
  });
  // 仅抓 DOM 快照的轻量 tracing：失败时可回放结构，避免 screenshots+sources
  // 在 2 核 CI runner 上给每个用例叠加重型开销。
  if (trace) await context.tracing.start({ snapshots: true });

  let worker = context.serviceWorkers()[0];
  if (worker === undefined) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  return { context, extensionId, externalRequests, extensionPath, userDataDir };
}

export async function openExtensionPage(context, extensionId, relativePath) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${relativePath}`);
  return page;
}

export function openPopup(extension) {
  return openExtensionPage(extension.context, extension.extensionId, 'src/popup/popup.html');
}

export function openDashboard(extension) {
  return openExtensionPage(extension.context, extension.extensionId, 'src/dashboard/index.html');
}

export async function resetData(page) {
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('worktodo');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = [...database.objectStoreNames];
    if (stores.length > 0) {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(stores, 'readwrite');
        for (const store of stores) transaction.objectStore(store).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }
    database.close();
    await chrome.storage.local.clear();
  });
}

export async function assertNoExternalRequests(extension) {
  expect(extension.externalRequests, '扩展运行期间不应发起外部网络请求').toEqual([]);
}

export async function blockEditorAutosave(page) {
  await page.evaluate(async () => {
    const { TaskService } = await import('../services/task-service.js');
    const originalEdit = TaskService.prototype.edit;
    let release;
    window.__worktodoEditorAutosaveStarted = false;
    window.__worktodoReleaseEditorAutosave = () => release?.();
    TaskService.prototype.edit = async function blockedEditorAutosave(...args) {
      window.__worktodoEditorAutosaveStarted = true;
      await new Promise((resolve) => { release = resolve; });
      return originalEdit.call(this, ...args);
    };
  });
}

export async function releaseEditorAutosave(page) {
  await expect.poll(() => page.evaluate(() => window.__worktodoEditorAutosaveStarted)).toBe(true);
  await page.evaluate(() => window.__worktodoReleaseEditorAutosave());
}

async function removeDirectory(directory) {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}

async function closePages(context) {
  await Promise.all(context.pages().map((page) => page.close().catch(() => {})));
}

export const test = base.extend({
  extensionPath: [projectRoot, { option: true, scope: 'worker' }],
  userDataDir: async ({}, use) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'worktodo-e2e-'));
    await use(directory);
    await removeDirectory(directory);
  },
  workerUserDataDir: [async ({}, use) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'worktodo-e2e-worker-'));
    await use(directory);
    await removeDirectory(directory);
  }, { scope: 'worker' }],
  workerExtension: [async ({ extensionPath, workerUserDataDir }, use) => {
    const extension = await launchExtension({
      extensionPath,
      userDataDir: workerUserDataDir,
    });
    await use(extension);
    await extension.context.close();
  }, { scope: 'worker' }],
  // 跨 Dashboard 的冲突用例单独运行，保留每例独立浏览器以验证真实消息时序。
  isolatedExtension: async ({ extensionPath, userDataDir }, use, testInfo) => {
    const extension = await launchExtension({ extensionPath, userDataDir, trace: true });
    const setupPage = await openDashboard(extension);
    await resetData(setupPage);
    await setupPage.close();

    await use(extension);

    if (testInfo.status !== testInfo.expectedStatus) {
      const page = extension.context.pages().at(-1);
      if (page !== undefined) await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {});
      await extension.context.tracing.stop({ path: testInfo.outputPath('trace.zip') }).catch(() => {});
    } else {
      await extension.context.tracing.stop().catch(() => {});
    }
    expect(extension.externalRequests, '扩展运行期间不应发起外部网络请求').toEqual([]);
    await extension.context.close();
  },
  // 常规用例在每个 worker 内复用扩展浏览器；每例清空数据并关闭页面，保持数据隔离。
  extension: async ({ workerExtension }, use, testInfo) => {
    const extension = workerExtension;
    await closePages(extension.context);
    extension.externalRequests.length = 0;
    await extension.context.tracing.start({ snapshots: true });

    try {
      const setupPage = await openDashboard(extension);
      try {
        await resetData(setupPage);
      } finally {
        await setupPage.close().catch(() => {});
      }
      await use(extension);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        const page = extension.context.pages().at(-1);
        if (page !== undefined) await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {});
        await extension.context.tracing.stop({ path: testInfo.outputPath('trace.zip') }).catch(() => {});
      } else {
        await extension.context.tracing.stop().catch(() => {});
      }
      await closePages(extension.context);
      expect(extension.externalRequests, '扩展运行期间不应发起外部网络请求').toEqual([]);
    }
  },
});

/* 抽屉的次级区默认收起。幂等：已展开时不重复点击，避免把组收回去。 */
export async function openEditorGroup(page, groupValue) {
  const group = page.locator(`#task-editor [data-editor-group="${groupValue}"]`);
  const summary = group.locator('summary');
  if (await summary.count() > 0) {
    if (!(await group.evaluate((node) => node.open))) await summary.click();
  } else {
    const toggle = group.locator('[data-toggle-tags]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  }
  return group;
}

export { expect };
