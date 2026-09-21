/* 本地预览：把工作区里的扩展以未打包形式打开到 Edge，供人工验收当前代码。
   加载路径是仓库根目录而不是 dist/ 里的压缩包，所以看到的一定是工作区这一版。
   未打包扩展的代码在浏览器启动时读取一次，因此重新运行前要先关掉上一次的窗口，
   否则 Edge 会复用已有实例，加载的仍是旧代码。 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileDir = process.env.WORKTODO_PREVIEW_PROFILE
  ?? path.join(process.env.TEMP ?? process.env.TMP ?? '.', 'worktodo-edge-preview');
await mkdir(profileDir, { recursive: true });

const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  ...(channel === undefined ? {} : { channel }),
  args: [
    `--disable-extensions-except=${projectRoot}`,
    `--load-extension=${projectRoot}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

let worker = context.serviceWorkers()[0];
if (worker === undefined) worker = await context.waitForEvent('serviceworker', { timeout: 20_000 });
const extensionId = new URL(worker.url()).host;

const { version } = JSON.parse(await readFile(path.join(projectRoot, 'manifest.json'), 'utf8'));
const dashboardUrl = `chrome-extension://${extensionId}/src/dashboard/index.html`;

const page = context.pages()[0] ?? await context.newPage();
await page.goto(dashboardUrl);
await page.bringToFront();

/* 版本号直接读 manifest.json：浏览器里是不是最新一版，看这一行就能判断。 */
console.log(`扩展目录：${projectRoot}`);
console.log(`浏览器：${channel ?? 'bundled-chromium'}`);
console.log(`配置目录：${profileDir}`);
console.log(`版本：${version}`);
console.log(`工作台：${dashboardUrl}`);
console.log(`弹窗：chrome-extension://${extensionId}/src/popup/popup.html`);
console.log('关闭预览窗口即结束本次预览。');

context.on('close', () => process.exit(0));
setInterval(() => {}, 1 << 30);
