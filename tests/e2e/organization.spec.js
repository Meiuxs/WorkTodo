import { test, expect, openDashboard } from './fixtures.js';

test('任务编辑器可以创建、选择并保留标签', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('整理报价');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '整理报价' }).click();

  const editor = page.locator('#task-editor');
  await editor.getByLabel('新标签').fill('客户');
  await editor.getByRole('button', { name: '创建标签' }).click();
  await editor.getByRole('checkbox', { name: '客户' }).check();
  await editor.getByRole('button', { name: '保存任务' }).click();

  await page.getByRole('button', { name: '整理报价' }).click();
  await expect(editor.getByRole('checkbox', { name: '客户' })).toBeChecked();
});
