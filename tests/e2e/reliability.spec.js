import path from 'node:path';
import {
  test,
  expect,
  launchExtension,
  openDashboard,
  assertNoExternalRequests,
} from './fixtures.js';

test('关闭并重新打开扩展后任务仍然存在，且无外部请求', async ({ extensionPath, userDataDir }) => {
  const first = await launchExtension({ extensionPath, userDataDir });
  const firstDashboard = await openDashboard(first);
  await firstDashboard.getByLabel('记录一个新事项').fill('重启后仍然存在');
  await firstDashboard.locator('#quick-add-date').selectOption('today');
  await firstDashboard.getByRole('button', { name: '添加', exact: true }).click();
  await expect(firstDashboard.getByRole('button', { name: '重启后仍然存在' })).toBeVisible();
  await assertNoExternalRequests(first);
  await first.context.close();

  const second = await launchExtension({ extensionPath, userDataDir: path.resolve(userDataDir) });
  const secondDashboard = await openDashboard(second);
  await expect(secondDashboard.getByRole('button', { name: '重启后仍然存在' })).toBeVisible();
  await assertNoExternalRequests(second);
  await second.context.close();
});
