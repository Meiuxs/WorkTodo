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

test('全部任务可以按标签筛选并显示标签文字', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('客户甲报价');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '客户甲报价' }).click();
  const editor = page.locator('#task-editor');
  await editor.getByLabel('新标签').fill('客户');
  await editor.getByRole('button', { name: '创建标签' }).click();
  await editor.getByRole('checkbox', { name: '客户' }).check();
  await editor.getByRole('button', { name: '保存任务' }).click();

  await page.getByLabel('记录一个新事项').fill('无标签事项');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();

  await page.getByRole('button', { name: '全部任务' }).click();
  await page.getByLabel('标签', { exact: true }).selectOption({ label: '客户' });
  await expect(page.getByRole('button', { name: '客户甲报价' })).toBeVisible();
  await expect(page.getByText('#客户', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '无标签事项' })).not.toBeVisible();
});

test('父任务编辑器可以新增并持久化子任务', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('准备投标');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '准备投标' }).click();

  const editor = page.locator('#task-editor');
  await editor.getByLabel('添加子任务').fill('整理资质文件');
  await editor.getByRole('button', { name: '添加子任务', exact: true }).click();
  await expect(editor.getByRole('button', { name: '整理资质文件，待办', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: '保存任务' }).click();

  await page.getByRole('button', { name: '准备投标' }).click();
  await expect(editor.getByRole('button', { name: '整理资质文件，待办', exact: true })).toBeVisible();
});

test('保存子任务后焦点返回父任务编辑按钮', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('准备投标');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '准备投标' }).click();

  const editor = page.locator('#task-editor');
  await editor.getByLabel('添加子任务').fill('整理资质文件');
  await editor.getByRole('button', { name: '添加子任务', exact: true }).click();
  await editor.getByRole('button', { name: '整理资质文件' }).click();
  await editor.getByRole('button', { name: '保存任务' }).click();

  await expect(page.locator('[data-action="edit"]').filter({ hasText: '准备投标' })).toBeFocused();
});

test('父任务有未完成子任务时先确认且不自动完成子任务', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('发布版本');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '发布版本' }).click();
  const editor = page.locator('#task-editor');
  await editor.getByLabel('添加子任务').fill('执行回归测试');
  await editor.getByRole('button', { name: '添加子任务', exact: true }).click();
  await editor.getByRole('button', { name: '保存任务' }).click();

  const parent = page.locator('[data-task-id]').filter({ has: page.getByRole('button', { name: '发布版本' }) });
  await parent.getByRole('checkbox', { name: '完成任务' }).click();
  const confirmation = page.locator('#confirm-dialog');
  await expect(confirmation.getByRole('heading', { name: '仍有未完成子任务' })).toBeVisible();
  await confirmation.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('button', { name: '发布版本' })).toBeVisible();

  await parent.getByRole('checkbox', { name: '完成任务' }).click();
  await confirmation.getByRole('button', { name: '仍然完成' }).click();
  await page.getByRole('button', { name: '已完成' }).click();
  await expect(page.getByRole('button', { name: '发布版本' })).toBeVisible();
  await page.getByRole('button', { name: '发布版本' }).click();
  await expect(editor.getByRole('button', { name: '执行回归测试' })).toContainText('待办');
});
