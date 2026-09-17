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
  if (trace) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

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

export const test = base.extend({
  extensionPath: [projectRoot, { option: true }],
  userDataDir: async ({}, use) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'worktodo-e2e-'));
    await use(directory);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  },
  extension: async ({ extensionPath, userDataDir }, use, testInfo) => {
    const extension = await launchExtension({
      extensionPath,
      userDataDir,
      videoDir: testInfo.outputPath('video'),
      trace: true,
    });
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
});

export { expect };
