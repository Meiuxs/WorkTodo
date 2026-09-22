import { test, expect, openDashboard } from './fixtures.js';

async function createTodayTask(dashboard, title) {
  await dashboard.getByLabel('记录一个新事项').fill(title);
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: title, exact: true })).toBeVisible();
}

test('已有任务修改后关闭即可自动保存', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '自动保存前');
  await dashboard.getByRole('button', { name: '自动保存前', exact: true }).click();

  const editor = dashboard.locator('#task-editor');
  await editor.getByLabel('任务名称').fill('自动保存后');
  await expect(editor.locator('[data-editor-save-state]')).toHaveText('已保存', { timeout: 3000 });
  await expect(editor.getByRole('button', { name: '保存任务', exact: true })).toBeHidden();
  await dashboard.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(dashboard.getByRole('button', { name: '自动保存后', exact: true })).toBeVisible();

  await dashboard.getByRole('button', { name: '自动保存后', exact: true }).click();
  await expect(editor.getByLabel('任务名称')).toHaveValue('自动保存后');
});
