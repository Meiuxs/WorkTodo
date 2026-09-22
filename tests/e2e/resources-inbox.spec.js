import { test, expect, openDashboard } from './fixtures.js';

test('资料收集箱可以创建、搜索并关联网页资料', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '资料收集箱' }).click();
  await expect(dashboard.locator('#resources-heading')).toBeVisible();
  await expect(dashboard.getByLabel('搜索资料')).toHaveAttribute('title', '名称、链接、文件名或片段');

  await dashboard.getByRole('button', { name: '添加资料' }).click();
  const createDialog = dashboard.getByRole('dialog');
  await createDialog.getByLabel('资料名称').fill('项目规范');
  await createDialog.locator('[data-resource-url]').fill('https://example.com/spec');
  await createDialog.getByRole('button', { name: '保存资料' }).click();
  await expect(dashboard.getByText('项目规范')).toBeVisible();
  await expect(dashboard.getByText('未关联任务')).toBeVisible();

  await dashboard.getByLabel('搜索资料').fill('example.com');
  await expect(dashboard.getByText('项目规范')).toBeVisible();

  await dashboard.locator('[data-resource-id]').getByRole('button', { name: '删除' }).click();
  const confirmDialog = dashboard.locator('#confirm-dialog');
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByRole('heading', { name: '删除资料？' })).toBeVisible();
  await confirmDialog.getByRole('button', { name: '取消' }).click();
  await expect(confirmDialog).toBeHidden();
});

test('点击资料标题可以打开编辑表单并保存修改', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '资料收集箱' }).click();
  await dashboard.getByRole('button', { name: '添加资料' }).click();
  const createDialog = dashboard.locator('[data-resource-create-dialog]');
  await createDialog.getByLabel('资料名称').fill('待编辑资料');
  await createDialog.locator('[data-resource-url]').fill('https://example.com/edit');
  await createDialog.getByRole('button', { name: '保存资料' }).click();

  const card = dashboard.locator('[data-resource-id]').filter({ hasText: '待编辑资料' });
  await card.getByRole('button', { name: '编辑资料：待编辑资料', exact: true }).click();

  const editDialog = dashboard.locator('[data-resource-create-dialog]');
  await expect(editDialog.locator('[data-resource-dialog-title]')).toHaveText('编辑资料');
  await expect(editDialog.getByLabel('资料名称')).toHaveValue('待编辑资料');
  await editDialog.getByLabel('资料名称').fill('已编辑资料');
  await editDialog.getByLabel('资料备注').fill('补充说明');
  await editDialog.getByRole('button', { name: '保存修改' }).click();

  await expect(dashboard.locator('[data-resource-id]').filter({ hasText: '已编辑资料' })).toBeVisible();
  await expect(dashboard.locator('[data-resource-id]').filter({ hasText: '待编辑资料' })).toHaveCount(0);
});

test('本地文件副本选项保持复选框与说明文字横向对齐', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByRole('button', { name: '资料收集箱' }).click();
  await dashboard.getByRole('button', { name: '添加资料' }).click();
  const dialog = dashboard.locator('[data-resource-create-dialog]');
  await dialog.getByLabel('资料类型').selectOption('file');

  const layout = await dialog.locator('[data-copy-field]').evaluate((node) => ({
    display: getComputedStyle(node).display,
    inputCenter: node.querySelector('input').getBoundingClientRect().top + node.querySelector('input').getBoundingClientRect().height / 2,
    textCenter: node.querySelector('span').getBoundingClientRect().top + node.querySelector('span').getBoundingClientRect().height / 2,
  }));
  expect(layout.display).toBe('flex');
  expect(Math.abs(layout.inputCenter - layout.textCenter)).toBeLessThan(4);
});
