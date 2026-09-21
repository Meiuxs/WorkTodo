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

  // Enter 与 Space 都要能展开：<details> 的原生键盘行为不能被破坏。
  await group.locator('summary').focus();
  await dashboard.keyboard.press('Space');
  await expect(group).toHaveJSProperty('open', false);
});

test('首屏无需滚动即可看全三行字段与全部入口行', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '首屏高度任务');
  await dashboard.getByRole('button', { name: '首屏高度任务' }).click();

  const editor = dashboard.locator('#task-editor');
  await expect(editor.locator('.editor-group[open]')).toHaveCount(0);

  const measured = await editor.evaluate((node) => {
    const drawerBody = node.querySelector('.drawer-body');
    const bodyRect = drawerBody.getBoundingClientRect();
    const fields = ['任务名称', '计划日期', '优先级'].map((label) => {
      const field = [...node.querySelectorAll('.field')]
        .find((item) => item.textContent.trim().startsWith(label));
      const rect = field.getBoundingClientRect();
      return rect.top >= bodyRect.top && rect.bottom <= bodyRect.bottom;
    });
    return {
      fieldsInside: fields.every((inside) => inside),
      scrollHeight: drawerBody.scrollHeight,
      clientHeight: drawerBody.clientHeight,
    };
  });

  expect(measured.fieldsInside).toBe(true);
  // 首屏就是全部内容：六组默认收起时抽屉主体不该需要滚动。
  expect(measured.scrollHeight).toBeLessThanOrEqual(measured.clientHeight + 1);
});

test('关闭抽屉后重新打开，次级区仍全部收起', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '收起状态任务');
  await dashboard.getByRole('button', { name: '收起状态任务' }).click();

  const editor = dashboard.locator('#task-editor');
  const group = await openEditorGroup(dashboard, 'tags');
  await expect(group).toHaveAttribute('open', '');

  await editor.getByRole('button', { name: '取消' }).click();
  await expect(editor).toBeHidden();

  await dashboard.getByRole('button', { name: '收起状态任务' }).click();
  await expect(editor).toBeVisible();
  await expect(editor.locator('.editor-group[open]')).toHaveCount(0);
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

test('星标开关切换字形与可访问名，并能被键盘操作', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '星标任务');
  await dashboard.getByRole('button', { name: '星标任务' }).click();

  const editor = dashboard.locator('#task-editor');
  const toggle = editor.locator('[data-star-toggle]');
  const checkbox = toggle.locator('input[name="starred"]');

  // 形状变化不能是唯一的信息来源：可访问名必须跟着状态走。
  // 用 exact 匹配，否则"已标记为星标，点击取消"也会被当成匹配。
  await expect(editor.getByRole('checkbox', { name: '标记为星标', exact: true })).toBeVisible();
  await expect(toggle.locator('[data-star-glyph]')).toHaveText('☆');

  await checkbox.focus();
  await dashboard.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(editor.getByRole('checkbox', { name: '已标记为星标，点击取消', exact: true })).toBeVisible();
  await expect(toggle.locator('[data-star-glyph]')).toHaveText('★');

  await editor.getByRole('button', { name: '保存任务' }).click();
  await dashboard.getByRole('button', { name: '星标任务' }).click();
  await expect(editor.locator('input[name="starred"]')).toBeChecked();
  await expect(editor.locator('[data-star-glyph]')).toHaveText('★');
});

test('并发冲突时冲突面板可见且焦点落在载入最新版本', async ({ extension }) => {
  const first = await openDashboard(extension);
  await createTodayTask(first, '冲突焦点任务');
  const second = await openDashboard(extension);
  const secondTitle = second.getByRole('button', { name: '冲突焦点任务' });
  await expect(secondTitle).toBeVisible();

  await secondTitle.click();
  const dialog = second.locator('#task-editor');
  await dialog.getByLabel('任务名称').fill('本地修改');
  await first.getByRole('checkbox', { name: '完成任务' }).first().click();
  await dialog.getByRole('button', { name: '保存任务' }).click();

  const reload = dialog.getByRole('button', { name: '载入最新版本' });
  await expect(reload).toBeFocused();
  // 面板在抽屉底部，必须真的落在视口内——用户看不到出口就等于没有出口。
  const inViewport = await reload.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  expect(inViewport).toBe(true);
});

test('深色主题下入口行细线可见且摘要用弱化色', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '深色抽屉任务');
  // initialize() 会调用 applyTheme 覆写 data-theme，等初始化完成再切换。
  await expect(dashboard.locator('.app')).toBeVisible();
  await dashboard.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await dashboard.getByRole('button', { name: '深色抽屉任务' }).click();

  const style = await dashboard.evaluate(() => ({
    border: getComputedStyle(document.querySelector('#task-editor .editor-group')).borderBottomColor,
    value: getComputedStyle(document.querySelector('#task-editor [data-group-value="category"]')).color,
  }));
  expect(style.border).toBe('rgb(49, 80, 75)');    // --line 深色 #31504b
  expect(style.value).toBe('rgb(165, 184, 179)');  // --muted 深色 #a5b8b3
});

test('超长任务标题不会把入口行挤出首屏', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  // 200 字的标题是字段上限，也是头部最容易失控的输入。
  const longTitle = '这是一个很长的任务标题'.repeat(12);
  await createTodayTask(dashboard, longTitle);
  await dashboard.getByRole('button', { name: longTitle }).click();

  const editor = dashboard.locator('#task-editor');
  const measured = await editor.evaluate((node) => {
    const heading = node.querySelector('[data-editor-title]').getBoundingClientRect();
    const body = node.querySelector('.drawer-body');
    return {
      headingLines: Math.round(heading.height / 26),
      headingHeight: Math.round(heading.height),
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
    };
  });

  // 头部只承担"我在改哪条任务"，全文在名称输入框里，所以最多两行。
  expect(measured.headingLines).toBeLessThanOrEqual(2);
  expect(measured.headingHeight).toBeLessThan(120);
  // 全部入口行默认收起时，长标题下首屏同样不需要滚动。
  expect(measured.scrollHeight).toBeLessThanOrEqual(measured.clientHeight + 1);
});

test('次级区的空提示与主操作共用同一左边界，且说明排在动作之前', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '对齐任务');
  await dashboard.getByRole('button', { name: '对齐任务' }).click();

  const editor = dashboard.locator('#task-editor');
  for (const group of ['tags', 'resources', 'subtasks']) {
    await openEditorGroup(dashboard, group);
  }

  const measured = await editor.evaluate((node) => {
    const box = (selector) => {
      const rect = node.querySelector(selector).getBoundingClientRect();
      return { left: Math.round(rect.left), width: Math.round(rect.width) };
    };
    const emptyBeforeAction = (group, action) => {
      const empty = node.querySelector(`[data-editor-group="${group}"] .empty`);
      const target = node.querySelector(action);
      return (empty.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    };
    return {
      contentLeft: box('input[name="title"]').left,
      contentWidth: box('.editor-groups').width,
      tagEmpty: box('[data-editor-group="tags"] .empty'),
      tagInput: box('#new-tag'),
      resourceEmpty: box('[data-editor-group="resources"] .empty'),
      resourceButton: box('[data-resource-add]'),
      subtaskEmpty: box('[data-editor-group="subtasks"] .empty'),
      subtaskInput: box('#subtask-title'),
      order: [
        emptyBeforeAction('tags', '#new-tag'),
        emptyBeforeAction('resources', '[data-resource-add]'),
        emptyBeforeAction('subtasks', '#subtask-title'),
      ],
    };
  });

  // 三处主操作与抽屉里其他控件同一个左边界：不再有"新标签"把输入框右移一格。
  expect(measured.tagInput.left).toBe(measured.contentLeft);
  expect(measured.resourceButton.left).toBe(measured.contentLeft);
  expect(measured.subtaskInput.left).toBe(measured.contentLeft);

  // 顺序一致：说明在前、动作在后。
  expect(measured.order).toEqual([true, true, true]);

  // 空提示通栏：三条分隔线一样长，标签区不再短一截。
  expect(measured.tagEmpty.width).toBe(measured.contentWidth);
  expect(measured.resourceEmpty.width).toBe(measured.contentWidth);
  expect(measured.subtaskEmpty.width).toBe(measured.contentWidth);
});

test('390px 下抽屉首屏与展开后的入口行都不横向溢出', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 390, height: 844 });
  await createTodayTask(dashboard, '窄屏抽屉任务');
  await dashboard.getByRole('button', { name: '窄屏抽屉任务' }).click();

  const editor = dashboard.locator('#task-editor');
  const measure = () => editor.evaluate((node) => {
    const drawerBody = node.querySelector('.drawer-body');
    return { scrollWidth: drawerBody.scrollWidth, clientWidth: drawerBody.clientWidth };
  });

  const collapsed = await measure();
  expect(collapsed.scrollWidth).toBeLessThanOrEqual(collapsed.clientWidth + 1);

  const moreGroup = await openEditorGroup(dashboard, 'more');
  await moreGroup.getByLabel('描述').fill('X'.repeat(200));
  const expanded = await measure();
  expect(expanded.scrollWidth).toBeLessThanOrEqual(expanded.clientWidth + 1);
});
