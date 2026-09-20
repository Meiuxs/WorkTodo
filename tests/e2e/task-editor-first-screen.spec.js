import { test, expect, openDashboard, openEditorGroup } from './fixtures.js';

async function createTodayTask(dashboard, title) {
  await dashboard.getByLabel('记录一个新事项').fill(title);
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: title })).toBeVisible();
}

/* 测试库每次都是干净的，categoryId 下拉只有"未归入列表"一项，
   要验证列表摘要随选择变化就得先真的建一个列表。 */
async function createList(dashboard, name) {
  await dashboard.getByRole('button', { name: '设置', exact: true }).click();
  await dashboard.locator('#new-category').fill(name);
  await dashboard.getByRole('button', { name: '创建列表' }).click();
  await dashboard.getByRole('button', { name: '今天', exact: true }).click();
  await expect(dashboard.locator('#page-title')).toHaveText('今日工作');
}

test('新建任务时首屏只有三行字段，次级区全部收起', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.getByLabel('记录一个新事项').fill('首屏任务');
  await dashboard.getByRole('button', { name: '更多字段' }).click();

  const editor = dashboard.locator('#task-editor');
  await expect(editor.getByLabel('任务名称')).toHaveValue('首屏任务');
  await expect(editor.getByLabel('计划日期')).toBeVisible();
  await expect(editor.getByLabel('优先级')).toBeVisible();

  // 次级区默认全部收起。
  await expect(editor.locator('.editor-group[open]')).toHaveCount(0);

  // 新建时出现四行（列表/标签/重复任务/更多信息）；资料与子任务不出现。
  // 行统一留在 DOM 里靠 hidden 控制，所以断言可见性而不是元素数量。
  await expect(editor.locator('[data-editor-group]:not([hidden])')).toHaveCount(4);
  await expect(editor.locator('[data-editor-group="resources"]')).toBeHidden();
  await expect(editor.locator('[data-editor-group="subtasks"]')).toBeHidden();
});

test('已有任务时首屏三行字段可见，出现资料与子任务行而不出现重复行', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '已有任务');
  await dashboard.getByRole('button', { name: '已有任务' }).click();

  const editor = dashboard.locator('#task-editor');
  await expect(editor.getByLabel('任务名称')).toHaveValue('已有任务');
  await expect(editor.locator('.editor-group[open]')).toHaveCount(0);
  await expect(editor.locator('[data-editor-group]:not([hidden])')).toHaveCount(5);
  await expect(editor.locator('[data-editor-group="resources"]')).toBeVisible();
  await expect(editor.locator('[data-editor-group="subtasks"]')).toBeVisible();
  await expect(editor.locator('[data-editor-group="recurring"]')).toBeHidden();
});

test('入口行可键盘展开，展开后内部控件可聚焦', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '键盘任务');
  await dashboard.getByRole('button', { name: '键盘任务' }).click();

  const group = dashboard.locator('#task-editor [data-editor-group="tags"]');
  await group.locator('summary').focus();
  await dashboard.keyboard.press('Enter');
  await expect(group).toHaveAttribute('open', '');
  await group.getByLabel('新标签').focus();
  await expect(group.getByLabel('新标签')).toBeFocused();
});

test('分区标题已删除且只保留一套折叠词汇', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '词汇任务');
  await dashboard.getByRole('button', { name: '词汇任务' }).click();

  const editor = dashboard.locator('#task-editor');
  await expect(editor.locator('.drawer-section-label')).toHaveCount(0);
  await expect(editor.locator('.editor-more')).toHaveCount(0);
  await expect(editor.locator('.editor-group:not([hidden])')).toHaveCount(5);
});

test('入口行摘要随编辑实时更新', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '摘要任务');
  await dashboard.getByRole('button', { name: '摘要任务' }).click();

  const editor = dashboard.locator('#task-editor');
  const value = (name) => editor.locator(`[data-group-value="${name}"]`);

  await expect(value('category')).toHaveText('未归入列表');
  await expect(value('tags')).toHaveText('未添加');
  await expect(value('resources')).toHaveText('无');
  await expect(value('subtasks')).toHaveText('无');
  await expect(value('more')).toHaveText('未填写');

  // 子任务：先展开再添加，摘要变成 0/1 完成。
  const subtaskGroup = await openEditorGroup(dashboard, 'subtasks');
  await subtaskGroup.getByLabel('添加子任务').fill('摘要子任务');
  await subtaskGroup.getByRole('button', { name: '添加子任务', exact: true }).click();
  await expect(value('subtasks')).toHaveText('0/1 完成');

  // 更多信息：填描述后摘要不再是"未填写"。
  const moreGroup = await openEditorGroup(dashboard, 'more');
  await moreGroup.getByLabel('描述').fill('一段描述');
  await expect(value('more')).toHaveText('已填写');
});

test('切换列表与勾选标签后摘要立即更新', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createList(dashboard, '工作');
  await createTodayTask(dashboard, '列表摘要任务');
  await dashboard.getByRole('button', { name: '列表摘要任务' }).click();

  const editor = dashboard.locator('#task-editor');
  const categoryGroup = await openEditorGroup(dashboard, 'category');
  await categoryGroup.getByLabel('列表').selectOption({ label: '工作' });
  await expect(editor.locator('[data-group-value="category"]')).toHaveText('工作');

  const tagGroup = await openEditorGroup(dashboard, 'tags');
  await tagGroup.getByLabel('新标签').fill('摘要标签');
  await tagGroup.getByRole('button', { name: '创建标签' }).click();
  await tagGroup.getByRole('checkbox', { name: '摘要标签' }).check();
  await expect(editor.locator('[data-group-value="tags"]')).toHaveText('1 个');
});
