import { defineConfig } from '@playwright/test';
import os from 'node:os';

// 本地开发用多核并行快速回环；每个带扩展的持久化浏览器会派生多个进程，
// 按核数/4 限流避免 CPU 超订导致重列渲染键盘交互抢不到时间片而偶发失败。
// CI runner 核心少，交给 Playwright 默认（约核数一半）。
const defaultWorkers = process.platform === 'win32'
  ? Math.min(2, Math.max(1, Math.floor(os.cpus().length / 4)))
  : undefined;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 6_000 },
  fullyParallel: true,
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : process.env.CI
      ? undefined
      : defaultWorkers,
  retries: 0,
  reporter: [['list']],
});
