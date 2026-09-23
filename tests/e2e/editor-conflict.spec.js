import { test, expect, openDashboard, blockEditorAutosave, releaseEditorAutosave } from './fixtures.js';

async function createTodayTask(dashboard, title) {
  await dashboard.getByLabel('记录一个新事项').fill(title);
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: title })).toBeVisible();
}

test('编辑抽屉校验失败保持打开，Esc 关闭并恢复焦点', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '编辑抽屉任务');

  const titleButton = dashboard.getByRole('button', { name: '编辑抽屉任务' });
  await titleButton.click();
  const dialog = dashboard.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.field-hint')).toHaveCount(0);
  await expect(dialog.locator('[data-editor-group="recurring"]')).toBeHidden();
  await dialog.getByLabel('开始时间').fill('10:00');
  await dialog.getByLabel('截止时间').fill('09:00');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/截止时间必须晚于开始时间/)).toBeVisible();

  await dialog.getByLabel('截止时间').fill('11:00');
  await expect(dialog.locator('[data-editor-save-state]')).toHaveText('已保存', { timeout: 3000 });
  await dashboard.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(titleButton).toBeFocused();

  await titleButton.click();
  await expect(dialog).toBeVisible();
  await dashboard.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(titleButton).toBeFocused();
});

test('两个 Dashboard 同时编辑同一 revision 时显示冲突并提供恢复', async ({ isolatedExtension: extension }) => {
  const first = await openDashboard(extension);
  await createTodayTask(first, '并发任务');
  const second = await openDashboard(extension);
  const secondTitle = second.getByRole('button', { name: '并发任务' });
  await expect(secondTitle).toBeVisible();

  await secondTitle.click();
  const secondDialog = second.getByRole('dialog');
  await blockEditorAutosave(second);
  await secondDialog.getByLabel('任务名称').fill('保留的本地修改');

  await first.getByRole('checkbox', { name: '完成任务' }).first().click();
  await releaseEditorAutosave(second);

  await expect(secondDialog.getByText('这个任务刚刚在另一个窗口更新过')).toBeVisible();
  await expect(secondDialog.getByRole('button', { name: '保留为新任务' })).toBeVisible();
  await secondDialog.getByRole('button', { name: '载入最新版本' }).click();
  await expect(secondDialog.getByLabel('任务名称')).toHaveValue('并发任务');
});
