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

test('通过更多字段新增任务并保存标签后可筛选', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('编辑器标签任务');
  await page.getByRole('button', { name: '更多字段' }).click();

  const editor = page.locator('#task-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('任务名称')).toHaveValue('编辑器标签任务');
  await editor.getByLabel('新标签').fill('编辑器标签');
  await editor.getByRole('button', { name: '创建标签' }).click();
  await editor.getByRole('checkbox', { name: '编辑器标签' }).check();
  await editor.getByRole('button', { name: '保存任务' }).click();

  await page.getByLabel('记录一个新事项').fill('无标签对照');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '全部任务' }).click();
  await page.getByLabel('标签', { exact: true }).selectOption({ label: '编辑器标签' });

  await expect(page.getByRole('button', { name: '编辑器标签任务' })).toBeVisible();
  await expect(page.getByText('#编辑器标签', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '无标签对照' })).not.toBeVisible();
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

  await page.reload();
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

test('标签和子任务在键盘与 390px 视口下不溢出并恢复焦点', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.setViewportSize({ width: 390, height: 844 });
  const longTag = 'T'.repeat(50);
  const longSubtask = 'S'.repeat(200);
  await page.getByLabel('记录一个新事项').fill('窄屏组织任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('button', { name: '窄屏组织任务' }).focus();
  await page.keyboard.press('Enter');

  const editor = page.locator('#task-editor');
  await expect(editor.getByLabel('任务名称')).toBeFocused();
  await editor.getByLabel('新标签').fill(longTag);
  await editor.getByLabel('新标签').press('Enter');
  await expect(editor.getByRole('checkbox', { name: longTag, exact: true })).toBeVisible();
  await expect(editor).toBeVisible();
  await editor.getByRole('checkbox', { name: longTag, exact: true }).check();

  await editor.getByLabel('添加子任务').fill(longSubtask);
  await editor.getByLabel('添加子任务').press('Enter');
  const subtaskLabel = `${longSubtask}，待办`;
  await expect(editor.getByRole('button', { name: subtaskLabel, exact: true })).toBeVisible();
  await expect(editor).toBeVisible();

  const duplicateSubtask = '双击只创建一条';
  await editor.getByLabel('添加子任务').fill(duplicateSubtask);
  await editor.getByRole('button', { name: '添加子任务', exact: true }).dblclick();
  await expect(editor.getByRole('button', { name: `${duplicateSubtask}，待办`, exact: true })).toHaveCount(1);
  await expect(editor).toBeVisible();

  const editorLayout = await page.evaluate(({ tagName, subtaskName }) => {
    const drawerBody = document.querySelector('#task-editor .drawer-body');
    const bodyStyle = getComputedStyle(drawerBody);
    const bodyRect = drawerBody.getBoundingClientRect();
    const tagOption = [...document.querySelectorAll('#task-editor .tag-option')]
      .find((option) => option.textContent.trim() === tagName);
    const subtaskRow = [...document.querySelectorAll('#task-editor .subtask-row')]
      .find((row) => row.getAttribute('aria-label') === subtaskName);
    return {
      scrollWidth: drawerBody.scrollWidth,
      clientWidth: drawerBody.clientWidth,
      contentRight: bodyRect.right - Number.parseFloat(bodyStyle.paddingRight),
      tagRight: tagOption.getBoundingClientRect().right,
      subtaskRight: subtaskRow.getBoundingClientRect().right,
    };
  }, { tagName: longTag, subtaskName: subtaskLabel });
  expect(editorLayout.scrollWidth).toBeLessThanOrEqual(editorLayout.clientWidth + 1);
  expect(editorLayout.tagRight).toBeLessThanOrEqual(editorLayout.contentRight + 1);
  expect(editorLayout.subtaskRight).toBeLessThanOrEqual(editorLayout.contentRight + 1);

  await page.keyboard.press('Escape');

  // 抽屉里已有未保存修改：Esc 先弹出放弃确认，确认后才关闭并恢复焦点。
  const discardDialog = page.locator('#confirm-dialog');
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole('button', { name: '放弃修改' }).click();

  await expect(page.getByRole('button', { name: '窄屏组织任务' })).toBeFocused();

  await page.getByRole('button', { name: '窄屏组织任务' }).click();
  await editor.getByRole('checkbox', { name: longTag, exact: true }).check();
  await editor.getByRole('button', { name: '保存任务' }).click();
  await page.getByLabel('记录一个新事项').fill('无标签窄屏任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '添加', exact: true }).click();

  await page.getByRole('button', { name: '全部任务' }).click();
  await page.getByLabel('标签', { exact: true }).selectOption({ label: longTag });
  await expect(page.getByRole('button', { name: '窄屏组织任务' })).toBeVisible();
  await expect(page.getByRole('button', { name: '无标签窄屏任务' })).not.toBeVisible();

  const allTasksOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(allTasksOverflow.scrollWidth).toBeLessThanOrEqual(allTasksOverflow.clientWidth + 1);
});
