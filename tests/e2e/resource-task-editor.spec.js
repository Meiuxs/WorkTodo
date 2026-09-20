import { test, expect, openDashboard, openEditorGroup } from './fixtures.js';

test('任务可以关联网页资料、文本片段和本地文件元数据', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('准备评审');
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();

  const task = dashboard.getByRole('button', { name: '准备评审' });
  await task.click();
  const editor = dashboard.getByRole('dialog').first();
  await openEditorGroup(dashboard, 'resources');
  await editor.getByRole('button', { name: '添加资料' }).click();

  const resourceDialog = dashboard.getByRole('dialog').last();
  await resourceDialog.getByLabel('资料类型').selectOption('url');
  await resourceDialog.getByLabel('资料名称').fill('评审规范');
  await resourceDialog.getByLabel('网页链接').fill('https://example.com/review');
  await resourceDialog.getByRole('button', { name: '保存资料' }).click();
  await expect(editor.getByText('评审规范')).toBeVisible();
  await expect(editor.getByText('相关资料 1')).toBeVisible();

  await editor.getByRole('button', { name: '添加资料' }).click();
  const snippetDialog = dashboard.getByRole('dialog').last();
  await snippetDialog.getByLabel('资料类型').selectOption('snippet');
  await snippetDialog.getByLabel('资料名称').fill('会议结论');
  await snippetDialog.getByLabel('文本片段').fill('先确认接口负责人');
  await snippetDialog.getByRole('button', { name: '保存资料' }).click();
  await expect(editor.getByText('会议结论')).toBeVisible();
  await expect(editor.getByText('相关资料 2')).toBeVisible();

  await editor.getByRole('button', { name: '添加资料' }).click();
  const fileDialog = dashboard.getByRole('dialog').last();
  await fileDialog.getByLabel('资料类型').selectOption('file');
  await fileDialog.locator('[data-resource-file]').setInputFiles({ name: '评审记录.txt', mimeType: 'text/plain', buffer: Buffer.from('记录') });
  await fileDialog.getByRole('button', { name: '保存资料' }).click();
  await expect(editor.getByText('评审记录.txt', { exact: true })).toBeVisible();
  await expect(editor.getByText('相关资料 3')).toBeVisible();
});
