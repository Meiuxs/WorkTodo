import { test, expect, openDashboard, openEditorGroup } from './fixtures.js';

// 高级筛选默认收起：要用到标签、日期这类低频条件，先展开面板。
async function openAdvancedFilters(page) {
  const panel = page.locator('#advanced-filters');
  if (await panel.isHidden()) await page.getByRole('button', { name: /^高级筛选/ }).click();
  await expect(panel).toBeVisible();
}

// 展开今日页的已完成折叠区。
async function dashboardOpenFold(page) {
  await page.locator('#completed-today-count').click();
}

test('任务编辑器可以创建、选择并保留标签', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('整理报价');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '整理报价' }).click();

  const editor = page.locator('#task-editor');
  await openEditorGroup(page, 'tags');
  await editor.getByLabel('新标签').fill('客户');
  await editor.getByRole('button', { name: '创建标签' }).click();
  await editor.getByRole('checkbox', { name: '客户' }).check();
  await expect(editor.locator('[data-editor-save-state]')).toHaveText('已保存', { timeout: 3000 });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '整理报价' }).click();
  await openEditorGroup(page, 'tags');
  await expect(editor.getByRole('checkbox', { name: '客户' })).toBeChecked();
});

test('全部任务可以按标签筛选并显示标签文字', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('客户甲报价');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '客户甲报价' }).click();
  const editor = page.locator('#task-editor');
  await openEditorGroup(page, 'tags');
  await editor.getByLabel('新标签').fill('客户');
  await editor.getByRole('button', { name: '创建标签' }).click();
  await editor.getByRole('checkbox', { name: '客户' }).check();
  await expect(editor.locator('[data-editor-save-state]')).toHaveText('已保存', { timeout: 3000 });
  await page.keyboard.press('Escape');

  await page.getByLabel('记录一个新事项').fill('无标签事项');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();

  await page.getByRole('button', { name: '全部任务' }).click();
  await openAdvancedFilters(page);
  await page.getByLabel('标签', { exact: true }).selectOption({ label: '客户' });
  await expect(page.getByRole('button', { name: '客户甲报价' })).toBeVisible();
  await expect(page.getByText('#客户', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '无标签事项' })).not.toBeVisible();
});

test('通过更多字段新增任务并保存标签后可筛选', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('编辑器标签任务');
  await page.getByRole('button', { name: '补充详情' }).click();

  const editor = page.locator('#task-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('任务名称')).toHaveValue('编辑器标签任务');
  await openEditorGroup(page, 'tags');
  await editor.getByLabel('新标签').fill('编辑器标签');
  await editor.getByRole('button', { name: '创建标签' }).click();
  await editor.getByRole('checkbox', { name: '编辑器标签' }).check();
  await editor.getByRole('button', { name: '保存任务' }).click();

  await page.getByLabel('记录一个新事项').fill('无标签对照');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '全部任务' }).click();
  await openAdvancedFilters(page);
  await page.getByLabel('标签', { exact: true }).selectOption({ label: '编辑器标签' });

  await expect(page.getByRole('button', { name: '编辑器标签任务' })).toBeVisible();
  await expect(page.getByText('#编辑器标签', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '无标签对照' })).not.toBeVisible();
});

test('全部任务的筛选区默认只有搜索与状态，高级条件按需展开', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('渐进披露任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();

  await page.getByRole('button', { name: '全部任务' }).click();
  await expect(page.getByLabel('搜索')).toBeVisible();
  await expect(page.getByLabel('状态')).toBeVisible();
  await expect(page.locator('#advanced-filters')).toBeHidden();
  // 没有条件时「清空筛选」不占位：它不是又一个没填的输入框。
  await expect(page.getByRole('button', { name: '清空筛选' })).toBeHidden();

  await page.getByRole('button', { name: /^高级筛选/ }).click();
  await expect(page.locator('#advanced-filters')).toBeVisible();

  await page.getByLabel('状态').selectOption('todo');
  await expect(page.getByRole('button', { name: '清空筛选' })).toBeVisible();
  // 编辑器里也有一个优先级下拉：限定在筛选面板内取值。
  const advanced = page.locator('#advanced-filters');
  await advanced.getByLabel('优先级').selectOption('high');
  await expect(page.locator('#advanced-count')).toContainText('1');

  // 条件留在 hash 里：刷新后面板自动展开，不会"收着却仍在生效"。
  await page.reload();
  await expect(page.locator('#advanced-filters')).toBeVisible();
  await expect(advanced.getByLabel('优先级')).toHaveValue('high');

  await page.getByRole('button', { name: '清空筛选' }).click();
  await expect(page.locator('#advanced-filters')).toBeHidden();
  await expect(page.getByRole('button', { name: '清空筛选' })).toBeHidden();
  await expect(page.getByLabel('状态')).toHaveValue('');
  await expect(page.getByRole('button', { name: '渐进披露任务' })).toBeVisible();
});

test('父任务编辑器可以新增并持久化子任务', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('准备投标');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '准备投标' }).click();

  const editor = page.locator('#task-editor');
  await openEditorGroup(page, 'subtasks');
  await editor.getByLabel('添加子任务').fill('整理资质文件');
  await editor.getByRole('button', { name: '添加子任务', exact: true }).click();
  await expect(editor.getByRole('button', { name: '整理资质文件，待办', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.reload();
  await page.getByRole('button', { name: '准备投标' }).click();
  await openEditorGroup(page, 'subtasks');
  await expect(editor.getByRole('button', { name: '整理资质文件，待办', exact: true })).toBeVisible();
});

test('保存子任务后焦点返回父任务编辑按钮', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('准备投标');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '准备投标' }).click();

  const editor = page.locator('#task-editor');
  await openEditorGroup(page, 'subtasks');
  await editor.getByLabel('添加子任务').fill('整理资质文件');
  await editor.getByRole('button', { name: '添加子任务', exact: true }).click();
  await editor.getByRole('button', { name: '整理资质文件' }).click();
  await page.keyboard.press('Escape');

  await expect(page.locator('[data-action="edit"]').filter({ hasText: '准备投标' })).toBeFocused();
});

test('子任务内联嵌套在父行下并可单独勾选更新进度', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('编写文档');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '编写文档' }).click();
  const editor = page.locator('#task-editor');
  await openEditorGroup(page, 'subtasks');
  await editor.getByLabel('添加子任务').fill('拟初稿');
  await editor.getByRole('button', { name: '添加子任务', exact: true }).click();
  await editor.getByLabel('添加子任务').fill('同行评审');
  await editor.getByRole('button', { name: '添加子任务', exact: true }).click();
  await page.keyboard.press('Escape');

  const parent = page.locator('[data-task-id]').filter({ has: page.getByRole('button', { name: '编写文档' }) });
  await expect(parent.getByRole('button', { name: '拟初稿' })).toBeVisible();
  await expect(parent.getByRole('button', { name: '同行评审' })).toBeVisible();
  await expect(parent.getByText('子任务 0/2')).toBeVisible();

  await parent.getByRole('checkbox', { name: '完成子任务' }).first().click();
  await expect(parent.getByText('子任务 1/2')).toBeVisible();
});

test('完成父任务会先确认并级联完成子任务', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('发布版本');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '发布版本' }).click();
  const editor = page.locator('#task-editor');
  await openEditorGroup(page, 'subtasks');
  await editor.getByLabel('添加子任务').fill('执行回归测试');
  await editor.getByRole('button', { name: '添加子任务', exact: true }).click();
  await page.keyboard.press('Escape');

  const parent = page.locator('[data-task-id]').filter({ has: page.getByRole('button', { name: '发布版本' }) });
  await parent.getByRole('checkbox', { name: '完成任务' }).click();
  const confirmation = page.locator('#confirm-dialog');
  await expect(confirmation.getByRole('heading', { name: '完成父任务及其子任务？' })).toBeVisible();
  await confirmation.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('button', { name: '发布版本' })).toBeVisible();

  await parent.getByRole('checkbox', { name: '完成任务' }).click();
  await confirmation.getByRole('button', { name: '完成全部' }).click();
  // 级联完成的子任务不计入今日进度：分子分母同为顶层任务口径，不能出现 2 / 1。
  await expect(page.locator('.today-summary__metric strong')).toHaveText('1 / 1');
  await expect(page.locator('.progress-block .eyebrow')).toHaveText('完成率 100%');
  await page.getByRole('button', { name: '已完成' }).click();
  const doneParent = page.locator('[data-task-id]').filter({ has: page.getByRole('button', { name: '发布版本' }) });
  // 已完成行的恢复按钮可访问名是「恢复任务：发布版本」，非精确匹配会连同标题按钮一起命中。
  await expect(doneParent.getByRole('button', { name: '发布版本', exact: true })).toBeVisible();
  // 级联完成后子任务也进入已完成，并嵌在父行下、勾选态保持。
  await expect(doneParent.locator('[data-subtask-id]')).toHaveCount(1);
  // 级联完成后子任务可恢复，勾选控件的可访问名随状态改写为「恢复子任务：{标题}」。
  await expect(doneParent.getByRole('checkbox', { name: /子任务/ })).toBeChecked();
});

test('从菜单恢复父任务会确认后级联恢复子任务', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('恢复级联父任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '恢复级联父任务' }).click();
  const editor = page.locator('#task-editor');
  await openEditorGroup(page, 'subtasks');
  await editor.getByLabel('添加子任务').fill('恢复级联子任务');
  await editor.getByRole('button', { name: '添加子任务', exact: true }).click();
  await page.keyboard.press('Escape');

  // 级联完成：父任务带着子任务进入今日已完成折叠区。
  const parent = page.locator('[data-task-id]').filter({ has: page.getByRole('button', { name: '恢复级联父任务' }) });
  await parent.getByRole('checkbox', { name: '完成任务' }).click();
  const confirmation = page.locator('#confirm-dialog');
  await confirmation.getByRole('button', { name: '完成全部' }).click();
  await dashboardOpenFold(page);

  // 取消确认：只关掉对话框，父任务和子任务都保持已完成。
  const foldedParent = page.locator('#completed-today-list [data-task-id]').filter({ has: page.getByRole('button', { name: '恢复级联父任务' }) });
  await foldedParent.locator('summary[aria-label^="更多任务操作"]').click();
  await foldedParent.getByRole('button', { name: '恢复待办', exact: true }).click();
  await expect(confirmation.getByRole('heading', { name: '恢复父任务及其子任务？' })).toBeVisible();
  await confirmation.getByRole('button', { name: '取消' }).click();
  await expect(foldedParent).toBeVisible();

  // 确认后级联恢复：父任务回到今天待办，子任务同步回到未勾选。
  await foldedParent.locator('summary[aria-label^="更多任务操作"]').click();
  await foldedParent.getByRole('button', { name: '恢复待办', exact: true }).click();
  await confirmation.getByRole('button', { name: '恢复全部' }).click();
  const restoredParent = page.locator('#today-list [data-task-id]').filter({ has: page.getByRole('button', { name: '恢复级联父任务' }) });
  await expect(restoredParent).toContainText('待办');
  await expect(restoredParent.getByText('子任务 0/1')).toBeVisible();
  await expect(restoredParent.getByRole('checkbox', { name: '完成子任务：恢复级联子任务' })).toBeVisible();
});

test('标签和子任务在键盘与 390px 视口下不溢出并恢复焦点', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.setViewportSize({ width: 390, height: 844 });
  const longTag = 'T'.repeat(50);
  const longSubtask = 'S'.repeat(200);
  await page.getByLabel('记录一个新事项').fill('窄屏组织任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.getByRole('button', { name: '窄屏组织任务' }).focus();
  await page.keyboard.press('Enter');

  const editor = page.locator('#task-editor');
  await expect(editor.getByLabel('任务名称')).toBeFocused();
  await openEditorGroup(page, 'tags');
  await editor.getByLabel('新标签').fill(longTag);
  await editor.getByLabel('新标签').press('Enter');
  await expect(editor.getByRole('checkbox', { name: longTag, exact: true })).toBeVisible();
  await expect(editor).toBeVisible();
  await editor.getByRole('checkbox', { name: longTag, exact: true }).check();

  await openEditorGroup(page, 'subtasks');
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
  // 已有任务自动保存：Esc 直接关闭并恢复焦点。
  await expect(editor).toBeHidden();
  await expect(page.getByRole('button', { name: '窄屏组织任务' })).toBeFocused();

  await page.getByRole('button', { name: '窄屏组织任务' }).click();
  await openEditorGroup(page, 'tags');
  // 重新打开时标签已是持久化的选中态；没有发生变化，不应人为触发一次保存。
  await expect(editor.getByRole('checkbox', { name: longTag, exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByLabel('记录一个新事项').fill('无标签窄屏任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();

  await page.getByRole('button', { name: '全部任务' }).click();
  await openAdvancedFilters(page);
  await page.getByLabel('标签', { exact: true }).selectOption({ label: longTag });
  await expect(page.getByRole('button', { name: '窄屏组织任务' })).toBeVisible();
  await expect(page.getByRole('button', { name: '无标签窄屏任务' })).not.toBeVisible();

  const allTasksOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(allTasksOverflow.scrollWidth).toBeLessThanOrEqual(allTasksOverflow.clientWidth + 1);
});
