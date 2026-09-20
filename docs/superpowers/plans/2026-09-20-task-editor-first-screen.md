# Task Editor First Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把任务详情抽屉的首屏从"一屏装不下的字段墙"收敛为"三行字段 + 一列带摘要的可展开入口行"，让用户不滚动就能看清任务现状并知道该改哪一项。

**Architecture:** 只重排抽屉的信息架构，不动领域模型与服务层。六组次级内容各自包进一个 `<details class="editor-group">`，`summary` 承担可见标题与当前值摘要（收起不丢信息）；删除三个分区标题；星标从独立一行搬到任务名称行右侧成为 `☆`/`★` 开关。表单字段、`name` 属性与 `readChanges()` 契约完全不变。

**Tech Stack:** Manifest V3 浏览器扩展，原生 HTML/CSS/JavaScript，无构建步骤。测试用 `node --test`（单元）与 Playwright（E2E，拉起已加载扩展的 Edge）。

**Spec:** `docs/superpowers/specs/2026-09-20-task-editor-first-screen-design.md`

## Global Constraints

- 目标平台 Chromium 110+、统信 UOS、ARM64；Manifest V3、原生 HTML/CSS/JS。
- 运行时不依赖服务器、网络、Node.js、npm 或第三方 CDN；不引入图标字体、SVG 或远程资源（`☆`/`★`/`▸`/`▾` 是文本字符）。
- 不新增权限，不读取网页内容、浏览历史、密码、Cookie 或剪贴板。
- 样式只引用 `src/styles/tokens.css` 的变量，业务样式表不出现裸数值。
- 不通过缩小字号解决空间问题（权威规范 §6.1）。
- 形状、颜色、图标都不是唯一的信息来源（权威规范 §9）：星标必须有 `sr-only` 文案随状态变化。
- **不新增、不改名、不删除任何表单字段与 `name` 属性**；`readChanges()` 读到的键与类型保持不变。
- Git commit message 用中文，格式 `类型：变更内容`。
- `manifest.json` 的 `version` 是发布版本唯一来源；本次 PATCH：`1.7.1` → `1.7.2`。
- **E2E 前置**：`test-results/` 已累积上千文件，Playwright 启动时清理该目录会触发沙箱的批量删除保护并直接报错。所有 E2E 命令统一使用唯一临时输出目录：`npx playwright test --output=.superpowers/pw-<task>`。不要删除 `test-results/`，不要改 `playwright.config.js`。
- 单元测试命令：`npm run test:unit`。

## Review Focus

以下五类是 spec 隐含、但容易漏掉的失效场景，已分别绑定到拥有该代码的任务：

1. **收起后信息被藏起来**：摘要若不随编辑实时更新，"收起"就等于把信息拿走；用户在收起状态下改了下拉或勾了标签，摘要必须立刻变（Task 3）。
2. **键盘用户进不去收起区**：`summary` 必须是可聚焦、可 Enter/Space 触发的原生控件，展开后内部控件顺序不能被破坏（Task 2）。
3. **星标只有形状没有语义**：`☆`/`★` 若只靠字形表达状态，读屏与色觉障碍用户无法判断是否已标记（Task 4）。
4. **焦点落在不可见元素上**：任何把焦点移进收起区的路径都必须先展开该组，否则焦点会跑到折叠内容里（Task 5）。
5. **既有 E2E 被折叠打断**：`organization.spec.js` 与 `editor-conflict.spec.js` 里有直接触达标签/子任务/重复区的用例，改造后必须先展开对应组（Task 2 一并迁移）。

---

### Task 1: 回写权威设计规范 §4.4

`AGENTS.md` 要求"若实现与规范冲突，先更新规范和 README 的说明，再修改组件"，所以文档先行。

**Files:**
- Modify: `docs/superpowers/designs/2026-09-17-worktodo-ui-design.md`（§4.4 全节 + 头部 `> 更新：`）
- 不动：`README.md`（已核对：无抽屉相关描述）
- 不动：`docs/superpowers/specs/2026-09-18-worktodo-ux-v1.1-design.md`（历史版本规格，其表述由 §4.4 取代）

**Interfaces:**
- Consumes: 无
- Produces: 新的 §4.4 正文，作为抽屉信息架构的唯一定义来源；后续任务不得偏离

- [ ] **Step 1: 确认 §4.4 的当前行范围**

Run: `Select-String -Path docs/superpowers/designs/2026-09-17-worktodo-ui-design.md -Pattern "^### 4\.4|^### 4\.5" | ForEach-Object { "$($_.LineNumber): $($_.Line)" }`

Expected: 输出 §4.4 与 §4.5 两个标题行号，§4.4 在前。

- [ ] **Step 2: 用新正文替换 §4.4 全节**

把 §4.4 标题到 §4.5 标题之间的全部内容（含标题下方原有 8 条）替换为：

```markdown
### 4.4 任务编辑抽屉

抽屉适合编辑任务，不适合快速记录：

- 从右侧进入，桌面宽度约 `420px`，窄屏使用可用全宽。
- **首屏只放任务名称（含星标开关）、计划日期和优先级三项。** 列表、标签、重复任务、资料、子任务、描述与时间全部下沉为次级区。
- 星标是名称行右侧的 `☆` / `★` 开关，不单独占一行。它必须有随状态变化的可访问名，不能只靠字形表达"已标记"。
- 次级区一律以可展开入口行呈现：一行一个 `<details>`，`summary` 左侧是组名、右侧是**当前值或计数摘要**。摘要必须在用户改动后立即更新——收起不得把信息拿走。
- 折叠只用一套词汇（`.editor-group`），不再出现两种折叠外观；含 `<fieldset>` 的组把 `<legend>` 降为 `sr-only`，可见标题由 `summary` 承担。
- 默认全部收起，不记忆展开状态：每次打开表现一致。
- 出现条件：新建任务时出现列表、标签、重复任务、更多信息；已有任务时出现列表、标签、资料、子任务、更多信息（资料需要 task id，重复规则只能在创建时设定）。
- 底部固定"取消"和"保存任务"，抽屉主体独立滚动，并使用 `overscroll-behavior: contain`。
- 打开后焦点进入任务名称；Esc 和取消关闭，焦点回到触发元素。任何把焦点或注意力移入收起区的路径，都必须先展开该组。
- 保存失败不关闭抽屉，不清空输入；并发冲突提供"保留为新任务"和"载入最新版本"，并让冲突面板进入视野、焦点落在"载入最新版本"。
```

- [ ] **Step 3: 确认文档头部日期**

Run: `Select-String -Path docs/superpowers/designs/2026-09-17-worktodo-ui-design.md -Pattern "^> 更新：" | ForEach-Object { "$($_.LineNumber): $($_.Line)" }`

Expected: 第 4 行为 `> 更新：2026-09-20`。该日期是同日的侧栏任务所改，今天仍是同一天，**不需要改动**；确认一次即可，不要无谓地改日期。

- [ ] **Step 4: 校验写入结果**

Run: `Select-String -Path docs/superpowers/designs/2026-09-17-worktodo-ui-design.md -Pattern "首屏只放任务名称（含星标开关）|当前值或计数摘要|折叠只用一套词汇" | ForEach-Object { "$($_.LineNumber): $($_.Line)" }`

Expected: 三处都命中，且行号都小于 §4.5 标题所在行。

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/designs/2026-09-17-worktodo-ui-design.md
git commit -m "文档：改写任务编辑抽屉规范为首屏三字段与入口行"
```

---

### Task 2: 首屏结构与入口行（含既有 E2E 迁移）

**Files:**
- Modify: `src/dashboard/index.html`（`.drawer-body` 全部内容）
- Modify: `src/dashboard/index.css`（新增 `.editor-group` / `.title-row`；删除随分区标题一起作废的规则）
- Modify: `tests/e2e/fixtures.js`（新增共享 helper）
- Modify: `tests/e2e/organization.spec.js`（4 处需先展开组）
- Modify: `tests/e2e/editor-conflict.spec.js`（1 处断言需改）
- Create: `tests/e2e/task-editor-first-screen.spec.js`

**Interfaces:**
- Consumes: Task 1 的 §4.4 新正文
- Produces: `#task-editor [data-editor-group="<name>"]` 六行（`category` / `tags` / `recurring` / `resources` / `subtasks` / `more`）；`[data-group-value="<name>"]` 摘要元素；`.title-row` 与 `[data-star-toggle]`；`fixtures.js` 导出的 `openEditorGroup(page, groupValue)`

- [ ] **Step 1: 先加共享 helper**

在 `tests/e2e/fixtures.js` 末尾（`export { expect };` 之前）追加：

```js
/* 抽屉的次级区默认收起。幂等：已展开时不重复点击，避免把组收回去。 */
export async function openEditorGroup(page, groupValue) {
  const group = page.locator(`#task-editor [data-editor-group="${groupValue}"]`);
  if (!(await group.evaluate((node) => node.open))) {
    await group.locator('summary').click();
  }
  return group;
}
```

- [ ] **Step 2: 写失败测试**

新建 `tests/e2e/task-editor-first-screen.spec.js`：

```js
import { test, expect, openDashboard, openEditorGroup } from './fixtures.js';

async function createTodayTask(dashboard, title) {
  await dashboard.getByLabel('记录一个新事项').fill(title);
  await dashboard.locator('#quick-add-date').selectOption('today');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: title })).toBeVisible();
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
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx playwright test tests/e2e/task-editor-first-screen.spec.js --output=.superpowers/pw-te1`

Expected: 四个用例全部失败。第一条在 `toHaveCount(0)`（`.editor-group[open]` 找不到元素）或 `.editor-group` 计数处失败——此时抽屉里还没有 `.editor-group`。

- [ ] **Step 4: 重写抽屉的 `.drawer-body`**

`src/dashboard/index.html` 中，把 `.drawer-body` 从 `<p class="drawer-section-label">先确定</p>` 到 `section.editor-subtasks` 结束的整段替换为下面的结构。各组的**内部控件原样保留**（含所有 `name`、`maxlength`、`min`、`max` 属性），只做三件事：外层包 `<details>`、`legend` 加 `sr-only`、删掉可见的分区标题与重复的可见标题：

```html
        <div class="drawer-body">
          <div class="title-row">
            <label class="field">任务名称<input name="title" maxlength="200" required></label>
            <label class="star-toggle" data-star-toggle>
              <input class="sr-only" name="starred" type="checkbox">
              <span class="star-toggle__glyph" data-star-glyph aria-hidden="true">☆</span>
              <span class="sr-only" data-star-text>标记为星标</span>
            </label>
          </div>
          <p class="field-hint">先填标题和计划日期，其他可以稍后补。</p>
          <div class="field-grid">
            <label class="field">计划日期<input name="scheduledDate" type="date"></label>
            <label class="field">优先级<select name="priority"><option value="none">无</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          </div>
          <div class="editor-groups">
            <details class="editor-group" data-editor-group="category">
              <summary><span class="editor-group__label">列表</span><span class="editor-group__value" data-group-value="category">未归入列表</span></summary>
              <label class="field">列表<select name="categoryId"></select></label>
            </details>
            <details class="editor-group" data-editor-group="tags">
              <summary><span class="editor-group__label">标签</span><span class="editor-group__value" data-group-value="tags">未添加</span></summary>
              <fieldset class="tag-picker" data-tag-picker>
                <legend class="sr-only">标签</legend>
                <div class="tag-picker__options" data-tag-options></div>
                <div class="tag-picker__create">
                  <label for="new-tag">新标签</label>
                  <input id="new-tag" maxlength="50">
                  <button type="button" data-create-tag>创建标签</button>
                </div>
                <p class="form-message" data-tag-message role="alert"></p>
              </fieldset>
            </details>
            <details class="editor-group" data-editor-group="recurring" hidden>
              <summary><span class="editor-group__label">重复任务</span><span class="editor-group__value" data-group-value="recurring">不重复</span></summary>
              <fieldset class="recurring-picker" data-recurring-picker>
                <legend class="sr-only">重复任务</legend>
                <label class="check-field"><input name="recurring" type="checkbox"> 按规则自动创建下一项</label>
                <div class="field-grid" data-recurring-fields hidden>
                  <label class="field">重复方式<select name="recurrenceFrequency"><option value="daily">每天</option><option value="weekdays">每个工作日</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option><option value="custom">自定义间隔</option></select></label>
                  <label class="field">间隔<input name="recurrenceInterval" type="number" min="1" max="90" value="1"></label>
                  <label class="field" data-recurrence-unit>自定义单位<select name="recurrenceUnit"><option value="day">天</option><option value="week">周</option><option value="month">月</option></select></label>
                </div>
              </fieldset>
            </details>
            <details class="editor-group" data-editor-group="resources" hidden>
              <summary><span class="editor-group__label">资料</span><span class="editor-group__value" data-group-value="resources">无</span></summary>
              <section class="editor-resources" data-editor-resources>
                <div class="editor-section-heading"><h3 class="sr-only">相关资料 <span data-resource-count>0</span></h3><button type="button" class="button-secondary" data-resource-add>添加资料</button></div>
                <div class="editor-resource-list" data-resource-list></div>
              </section>
            </details>
            <details class="editor-group" data-editor-group="subtasks" hidden>
              <summary><span class="editor-group__label">子任务</span><span class="editor-group__value" data-group-value="subtasks">无</span></summary>
              <section class="editor-subtasks" data-editor-subtasks>
                <div class="subtask-list" data-subtask-list></div>
                <div class="subtask-create">
                  <label for="subtask-title">添加子任务</label>
                  <input id="subtask-title" maxlength="200">
                  <button type="button" data-subtask-create>添加子任务</button>
                </div>
                <p class="form-message" data-subtask-message role="alert"></p>
              </section>
            </details>
            <details class="editor-group" data-editor-group="more">
              <summary><span class="editor-group__label">更多信息</span><span class="editor-group__value" data-group-value="more">未填写</span></summary>
              <label class="field">描述<textarea name="description" rows="4" maxlength="10000"></textarea></label>
              <div class="field-grid">
                <label class="field">开始时间<input name="startTime" type="time"></label>
                <label class="field">截止时间<input name="dueTime" type="time"></label>
              </div>
            </details>
          </div>
          <p class="form-message" data-editor-message role="alert"></p>
          <div class="conflict-panel" data-editor-conflict hidden>
            <p>这个任务刚刚在另一个窗口更新过。你可以保留当前修改为新任务，或载入最新版本。</p>
            <div class="dialog-actions"><button type="button" data-editor-copy>保留为新任务</button><button type="button" class="button-primary" data-editor-reload>载入最新版本</button></div>
          </div>
        </div>
```

注意：`data-editor-resources` 与 `data-editor-subtasks` 从原来的 `<section>` 挪到了内层 `<section>` 上保持同名，`task-editor.js` 里 `resources.hidden = …` / `subtasks.hidden = …` 的写法因此会改到 body 而不是行（Task 3 处理行本身的显隐）。

- [ ] **Step 5: 加样式、清掉作废规则，并让入口行按出现条件显隐**

`src/dashboard/index.css` 中：

(a) 删除 `.drawer-section-label` 三条规则及其派生规则（`.drawer-section-label`、`.drawer-section-label--spaced`、`.drawer-section-label + .field`、`.drawer-section-label + .field-grid`、`.drawer-section-label ~ .editor-more`）。

(a2) 删除两条已失效的直接子元素规则：`.drawer-body > .field, .drawer-body > .check-field { margin-top: var(--sp-5); }` 与 `.drawer-body > .field:first-child { margin-top: 0; }`——改造后 `.drawer-body` 的直接子元素只剩 `.title-row` / `.field-hint` / `.field-grid` / `.editor-groups` / `.form-message` / `.conflict-panel`，标题字段搬进了 `.title-row`，这两条再也匹配不到任何元素。**保留 `.check-field` 自身的样式**：重复区的"按规则自动创建下一项"还在用它。

(b) 删除 `.editor-more` 的四条规则（`.editor-more`、`.editor-more summary`、`.editor-more summary::-webkit-details-marker`、`.editor-more summary::before`、`.editor-more[open] > summary::before`、`.editor-more[open] > summary`）。

(c) 在任务抽屉区块内新增：

```css
/* 名称行：输入框占满，右侧是星标开关。 */
.title-row { display: flex; align-items: flex-end; gap: var(--sp-3); }
.title-row > .field { flex: 1 1 auto; min-width: 0; }
.star-toggle {
  display: grid;
  place-items: center;
  width: var(--control-h-lg);
  height: var(--control-h-lg);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--surface-raised);
  color: var(--muted);
  cursor: pointer;
}
.star-toggle__glyph { font-size: var(--fs-lead); line-height: 1; }
.star-toggle:has(input:checked) { border-color: var(--teal); color: var(--teal); }
.star-toggle:focus-within { outline: 2px solid var(--focus); outline-offset: 2px; }

/* 入口行：容器一条上边线，每行一条下边线，避免相邻行叠成双线。 */
.editor-groups { margin-top: var(--sp-6); border-top: 1px solid var(--line); }
.editor-group { border-bottom: 1px solid var(--line); }
.editor-group > summary {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 44px;
  padding: var(--sp-2) 0;
  font-size: var(--fs-body);
  cursor: pointer;
}
.editor-group__label { color: var(--ink); }
.editor-group__value { margin-left: auto; color: var(--muted); font-size: var(--fs-ui); text-align: right; }
.editor-group > summary::-webkit-details-marker { display: none; }
.editor-group > summary::before { content: "▸"; color: var(--muted); }
.editor-group[open] > summary::before { content: "▾"; }
.editor-group[open] > summary + * { margin-top: var(--sp-3); }
.editor-group:last-child { border-bottom: 1px solid var(--line); }
```

(d) 把原先给独立区块用的外边距收进组内——它们现在都住在 `<details>` 里，外层间距由 `.editor-group` 的 `summary` 与 `[open] > summary + *` 负责：

- `.editor-subtasks { margin-top: 0; border-top: 0; padding-top: 0; }`
- `.tag-picker, .recurring-picker { margin: 0; }`
- `.editor-group .editor-section-heading { justify-content: flex-end; }`——该行的 `<h3>` 已改成 `sr-only`（`position: absolute`，脱离文档流），只剩"添加资料"按钮，否则 `.editor-section-heading` 原有的 `space-between` 会把按钮顶到左边。

已核对：`.editor-resources` 自身没有独立样式规则，无需改动。`data-resource-count` 保留在 `sr-only` 的 `<h3>` 内，`renderResources()` 里那两处 `resourceCount.textContent` 因此不必改动。

(e) `src/dashboard/task-editor.js`：**入口行的出现条件属于结构，本步一并做掉**（摘要在 Task 3）。在 `createTaskEditor` 顶部加：

```js
  const groupRows = new Map(
    [...dialog.querySelectorAll('[data-editor-group]')]
      .map((row) => [row.dataset.editorGroup, row]),
  );

  /* 行统一留在 DOM 里靠 hidden 控制：与既有的 resources.hidden / subtasks.hidden
     写法一致，也让"哪几行出现"集中在一处可读。 */
  function setGroupVisible(name, visible) {
    const row = groupRows.get(name);
    if (row !== undefined) row.hidden = !visible;
  }
```

然后替换四处显隐写法：

- `openNew()`：`recurringPicker.hidden = false;` → `setGroupVisible('recurring', true); setGroupVisible('resources', false); setGroupVisible('subtasks', false);`
- `openTask()`：`recurringPicker.hidden = true;` → `setGroupVisible('recurring', false);`
- `renderResources()`：`resources.hidden = true;` → `setGroupVisible('resources', false);`；`resources.hidden = false;` → `setGroupVisible('resources', true);`
- `renderSubtasks()`：`subtasks.hidden = !canManage;` → `setGroupVisible('subtasks', canManage);`

`const recurringPicker = dialog.querySelector('[data-recurring-picker]');` 在这两处替换后不再被引用，**连同这行一起删除**。

- [ ] **Step 6: 运行新测试确认通过**

Run: `npx playwright test tests/e2e/task-editor-first-screen.spec.js --output=.superpowers/pw-te2`

Expected: 4 passed。

- [ ] **Step 7: 迁移既有 E2E 到"先展开再操作"**

`tests/e2e/fixtures.js` 的 helper 已在 Step 1 加好。改动点（都在触达次级区控件之前插入一行 `await openEditorGroup(page, '<组名>');`）：

- `tests/e2e/organization.spec.js` 第 3 行起的用例：在第 11 行 `editor.getByLabel('新标签')` 之前插入 `await openEditorGroup(page, 'tags');`。
- 同文件第 20 行起的用例：在第 27 行之前同样插入。
- 同文件第 43 行起的用例：在第 51 行之前同样插入。
- 同文件第 150 行起的 390px 用例：在第 163 行之前插入 `await openEditorGroup(page, 'tags');`，在第 169 行之前插入 `await openEditorGroup(page, 'subtasks');`。
- `tests/e2e/editor-conflict.spec.js` 第 19 行，把
  `await expect(dialog.locator('[data-recurring-picker]')).toBeHidden();`
  改为
  `await expect(dialog.locator('[data-editor-group="recurring"]')).toBeHidden();`
  （重复规则从"一直存在但被隐藏的控件"改成"按出现条件显隐的入口行"，断言语义随之改变）。
- 各文件顶部 import 里补上 `openEditorGroup`。

- [ ] **Step 8: 跑受影响的 spec 确认通过**

Run: `npx playwright test tests/e2e/organization.spec.js tests/e2e/editor-conflict.spec.js --output=.superpowers/pw-te3`

Expected: 全部通过。若仍有失败，按同一条规则补 `openEditorGroup`（失败信息会指明是哪个控件不可见）。

- [ ] **Step 9: Commit**

```bash
git add src/dashboard/index.html src/dashboard/index.css tests/e2e/fixtures.js tests/e2e/organization.spec.js tests/e2e/editor-conflict.spec.js tests/e2e/task-editor-first-screen.spec.js
git commit -m "优化：任务详情抽屉首屏收敛为三字段加可展开入口行"
```

---

### Task 3: 摘要实时更新

**Files:**
- Modify: `src/dashboard/task-editor.js`
- Test: `tests/e2e/task-editor-first-screen.spec.js`（追加）

**Interfaces:**
- Consumes: Task 2 的 `[data-group-value="<name>"]` 六个摘要元素与 `[data-editor-group="<name>"]` 六行
- Produces: `renderGroupSummaries()`（模块内私有），在打开抽屉、`input`/`change` 与各区域渲染后调用；行显隐由它统一负责

- [ ] **Step 1: 写失败测试**

在 `tests/e2e/task-editor-first-screen.spec.js` 末尾追加：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx playwright test tests/e2e/task-editor-first-screen.spec.js --grep "摘要" --output=.superpowers/pw-te4`

Expected: 2 failed——摘要在实现前始终是 HTML 里的占位文案（`未归入列表` / `未添加` / `无` / `未填写`），首次改动后不会变。

- [ ] **Step 3: 实现 `renderGroupSummaries()`**

在 `src/dashboard/task-editor.js` 内，`createTaskEditor` 顶部拿到六个摘要元素（行的显隐已由 Task 2 的 `setGroupVisible` 负责，本任务不碰）：

```js
  const groupValues = new Map(
    [...dialog.querySelectorAll('[data-group-value]')]
      .map((node) => [node.dataset.groupValue, node]),
  );

  function setGroupValue(name, text) {
    const node = groupValues.get(name);
    if (node !== undefined) node.textContent = text;
  }

  /* 收起不丢信息：摘要是用户在收起状态下判断这条任务现状的唯一依据，
     所以每次改动都要重算，而不是只在打开抽屉时算一次。 */
  function renderGroupSummaries() {
    setGroupValue('category', category.selectedOptions[0]?.textContent ?? '未归入列表');

    const tagCount = selectedTagIds().length;
    setGroupValue('tags', tagCount === 0 ? '未添加' : `${tagCount} 个`);

    setGroupValue('recurring', recurringSummary());

    const resourceTotal = resourceList.querySelectorAll('[data-resource-detach]').length;
    setGroupValue('resources', resourceTotal === 0 ? '无' : `${resourceTotal} 条`);

    const subtaskTotal = subtaskList.querySelectorAll('[data-subtask-id]').length;
    const subtaskDone = subtaskList.querySelectorAll('[data-subtask-id][data-subtask-done]').length;
    setGroupValue('subtasks', subtaskTotal === 0 ? '无' : `${subtaskDone}/${subtaskTotal} 完成`);

    const filled = field(form, 'description').value.trim().length > 0
      || field(form, 'startTime').value.length > 0
      || field(form, 'dueTime').value.length > 0;
    setGroupValue('more', filled ? '已填写' : '未填写');
  }
```

`recurringSummary()` 按频率下拉的可见文案生成：

```js
  const FREQUENCY_LABELS = Object.freeze({
    daily: '每天',
    weekdays: '每个工作日',
    weekly: '每周',
    monthly: '每月',
    yearly: '每年',
  });
  const UNIT_LABELS = Object.freeze({ day: '天', week: '周', month: '月' });

  function recurringSummary() {
    if (!recurring.checked) return '不重复';
    const frequency = field(form, 'recurrenceFrequency').value;
    const interval = Number(field(form, 'recurrenceInterval').value);
    if (frequency === 'custom') {
      return `每 ${interval} ${UNIT_LABELS[field(form, 'recurrenceUnit').value] ?? '天'}`;
    }
    if (interval > 1) return `每 ${interval} ${frequency === 'weekly' ? '周' : '天'}`;
    return FREQUENCY_LABELS[frequency] ?? '不重复';
  }
```

- [ ] **Step 4: 接上调用点与行显隐**

- `renderSubtasks()`：渲染完列表后调用 `renderGroupSummaries()`。
- `renderResources()`：渲染完列表后调用 `renderGroupSummaries()`。
- `populateTags()` 与 `populateCategories()` 末尾各加一次 `renderGroupSummaries()`。
- `form.addEventListener('input', …)` 与 `'change'` 的既有监听里，在 `markDirty()` 之后追加 `renderGroupSummaries()`。
- `createSubtask()` 与标签创建成功后，`renderSubtasks()` / `loadTags()` 已经会触发重算。

子任务"已完成"的判定：`renderSubtasks()` 的模板里，在原有的 `.subtask-row` 按钮上**追加** `data-subtask-done` 属性（`task.lifecycle === 'completed'` 时输出），与 `data-subtask-id` 同处一个元素，供摘要计数与测试使用。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx playwright test tests/e2e/task-editor-first-screen.spec.js --output=.superpowers/pw-te5`

Expected: 6 passed。

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/task-editor.js tests/e2e/task-editor-first-screen.spec.js
git commit -m "优化：抽屉入口行摘要随编辑实时更新"
```

---

### Task 4: 名称行右侧的星标开关

**Files:**
- Modify: `src/dashboard/task-editor.js`
- Test: `tests/e2e/task-editor-first-screen.spec.js`（追加）

**Interfaces:**
- Consumes: Task 2 的 `.title-row` 与 `[data-star-toggle]` / `[data-star-glyph]` / `[data-star-text]`
- Produces: 星标切换时同步字形与 `sr-only` 文案；`readChanges()` 的 `starred` 取值路径不变

- [ ] **Step 1: 写失败测试**

在 `tests/e2e/task-editor-first-screen.spec.js` 末尾追加：

```js
test('星标开关切换字形与可访问名，并能被键盘操作', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '星标任务');
  await dashboard.getByRole('button', { name: '星标任务' }).click();

  const editor = dashboard.locator('#task-editor');
  const toggle = editor.locator('[data-star-toggle]');
  const checkbox = toggle.locator('input[name="starred"]');

  // 形状变化不能是唯一的信息来源：可访问名必须随状态变。
  await expect(toggle).toContainText('标记为星标');
  await expect(toggle.locator('[data-star-glyph]')).toHaveText('☆');

  await checkbox.focus();
  await dashboard.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(toggle).toContainText('已标记为星标，点击取消');
  await expect(toggle.locator('[data-star-glyph]')).toHaveText('★');

  await editor.getByRole('button', { name: '保存任务' }).click();
  await dashboard.getByRole('button', { name: '星标任务' }).click();
  await expect(editor.locator('input[name="starred"]')).toBeChecked();
  await expect(editor.locator('[data-star-glyph]')).toHaveText('★');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx playwright test tests/e2e/task-editor-first-screen.spec.js --grep "星标" --output=.superpowers/pw-te6`

Expected: 1 failed——字形与 `sr-only` 文案目前不会随勾选变化。

- [ ] **Step 3: 实现字形与文案同步**

在 `src/dashboard/task-editor.js` 顶部取元素：

```js
  const starGlyph = dialog.querySelector('[data-star-glyph]');
  const starText = dialog.querySelector('[data-star-text]');

  /* 星标只靠 ☆/★ 字形表达状态时，读屏与色觉障碍用户无法判断，
     所以可访问名必须跟着状态走。 */
  function renderStar() {
    const checked = field(form, 'starred').checked;
    starGlyph.textContent = checked ? '★' : '☆';
    starText.textContent = checked ? '已标记为星标，点击取消' : '标记为星标';
  }
```

在 `form` 的 `'change'` 监听里追加 `renderStar();`，并在 `openTask()` / `openNew()` 设置完 `starred` 之后各调用一次 `renderStar()`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx playwright test tests/e2e/task-editor-first-screen.spec.js --output=.superpowers/pw-te7`

Expected: 7 passed。

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/task-editor.js tests/e2e/task-editor-first-screen.spec.js
git commit -m "优化：星标改为名称行开关并同步可访问名"
```

---

### Task 5: 冲突面板进入视野并聚焦

**Files:**
- Modify: `src/dashboard/task-editor.js`
- Test: `tests/e2e/task-editor-first-screen.spec.js`（追加）

**Interfaces:**
- Consumes: 现有 `[data-editor-conflict]` 面板与 `[data-editor-reload]` 按钮
- Produces: 冲突出现时把面板滚入视野并聚焦"载入最新版本"

- [ ] **Step 1: 写失败测试**

在 `tests/e2e/task-editor-first-screen.spec.js` 末尾追加：

```js
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
  const visible = await reload.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  expect(visible).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx playwright test tests/e2e/task-editor-first-screen.spec.js --grep "冲突" --output=.superpowers/pw-te8`

Expected: 1 failed——目前 `save()` 在冲突时聚焦的是任务名称，不是"载入最新版本"。

- [ ] **Step 3: 实现**

`src/dashboard/task-editor.js` 的 `save()` 捕获分支：

```js
    } catch (error) {
      showMessage(errorMessage(error));
      if (error?.name === 'ConflictError') {
        conflict.hidden = false;
        // 面板在抽屉底部，收起改造后更容易落在视口外：用户只看到一行报错，
        // 不知道还有两个出口。先让它可见，再把焦点放到推荐动作上。
        conflict.scrollIntoView({ block: 'nearest' });
        dialog.querySelector('[data-editor-reload]').focus();
        return null;
      }
      field(form, 'title').focus();
      return null;
    } finally {
```

即把原来无条件的 `field(form, 'title').focus()` 移到非冲突分支。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx playwright test tests/e2e/task-editor-first-screen.spec.js tests/e2e/editor-conflict.spec.js --output=.superpowers/pw-te9`

Expected: 10 passed（新文件 8 条 + `editor-conflict.spec.js` 的 2 条）。若 `editor-conflict.spec.js` 第 55 行的"点击载入最新版本"因焦点变化受影响，按实际行为调整该处断言，不要回退实现。

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/task-editor.js tests/e2e/task-editor-first-screen.spec.js
git commit -m "优化：并发冲突时让面板进入视野并聚焦推荐动作"
```

---

### Task 6: 深色主题与窄屏验收、版本号与打包

**Files:**
- Test: `tests/e2e/task-editor-first-screen.spec.js`（追加）
- Modify: `manifest.json`
- 产物：`dist/WorkTodo-v1.7.2.zip`

**Interfaces:**
- Consumes: Task 1–5 的全部改动
- Produces: 可导入 Chromium 的发布包

- [ ] **Step 1: 写深色与窄屏验收测试**

在 `tests/e2e/task-editor-first-screen.spec.js` 末尾追加：

```js
test('深色主题下入口行细线可见且摘要对比度足够', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '深色抽屉任务');
  await expect(dashboard.locator('.app')).toBeVisible();
  await dashboard.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await dashboard.getByRole('button', { name: '深色抽屉任务' }).click();

  const style = await dashboard.evaluate(() => {
    const group = document.querySelector('#task-editor .editor-group');
    const value = document.querySelector('#task-editor [data-group-value="category"]');
    return {
      border: getComputedStyle(group).borderBottomColor,
      value: getComputedStyle(value).color,
      panel: getComputedStyle(document.querySelector('#task-editor')).backgroundColor,
    };
  });
  expect(style.border).not.toBe(style.panel);
  expect(style.value).not.toBe(style.panel);
});

test('390px 下抽屉首屏与展开后的入口行都不横向溢出', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 390, height: 844 });
  await createTodayTask(dashboard, '窄屏抽屉任务');
  await dashboard.getByRole('button', { name: '窄屏抽屉任务' }).click();

  const editor = dashboard.locator('#task-editor');
  const body = await editor.evaluate((node) => {
    const drawerBody = node.querySelector('.drawer-body');
    return { scrollWidth: drawerBody.scrollWidth, clientWidth: drawerBody.clientWidth };
  });
  expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);

  const moreGroup = await openEditorGroup(dashboard, 'more');
  await moreGroup.getByLabel('描述').fill('X'.repeat(200));
  const afterOpen = await editor.evaluate((node) => {
    const drawerBody = node.querySelector('.drawer-body');
    return { scrollWidth: drawerBody.scrollWidth, clientWidth: drawerBody.clientWidth };
  });
  expect(afterOpen.scrollWidth).toBeLessThanOrEqual(afterOpen.clientWidth + 1);
});
```

- [ ] **Step 2: 运行确认通过**

Run: `npx playwright test tests/e2e/task-editor-first-screen.spec.js --output=.superpowers/pw-te10`

Expected: 10 passed。

- [ ] **Step 3: 升级版本号**

把 `manifest.json` 的 `"version": "1.7.1"` 改为 `"version": "1.7.2"`。

- [ ] **Step 4: 跑单元测试**

Run: `npm run test:unit`

Expected: `pass 216`、`fail 0`。

- [ ] **Step 5: 跑全量 E2E**

Run: `npx playwright test --output=.superpowers/pw-te-full`

Expected: 90 passed、0 failed（原 80 条 + 本计划新增 10 条）。已知风险：`tests/e2e/ux-refactor.spec.js` 的「完成任务后滚动位置与其他行菜单展开态保持」是既有抖动（与本次改动无关），若它单独失败，重跑确认后记入交付说明，不要为它改实现。

- [ ] **Step 6: 打包并核对产物**

Run: `npm run package`，然后 `Get-ChildItem dist -Filter 'WorkTodo-v1.7.2.zip' | ForEach-Object { "$($_.Name)  $($_.Length) bytes" }`

Expected: 输出 `WorkTodo-v1.7.2.zip` 及其字节数。

- [ ] **Step 7: Commit**

```bash
git add manifest.json tests/e2e/task-editor-first-screen.spec.js
git commit -m "构建：升级到 v1.7.2 并生成发布包"
```

- [ ] **Step 8: 交付**

工作到此停止。tag 与 GitHub Release 不在本计划范围内。之后要发布，按 `AGENTS.md` 补齐带注释 tag、上传 `dist/WorkTodo-v1.7.2.zip`、在 `docs/releases.md` 追加六项记录。

---

## 未纳入本次范围（已确认不做）

- 不改领域模型与服务层；不让已有任务可编辑重复规则（领域里没有"本任务是否重复"的字段）。
- 不新增、不改名、不删除任何表单字段与 `name` 属性。
- 不引入图标资源或 SVG。
- 不改抽屉宽度、底部固定操作区与冲突的两个出口语义。
- 不改 Popup。
- 不为入口行增加"记住展开状态"。
- 不修改 `README.md`、`docs/superpowers/specs/2026-09-18-worktodo-ux-v1.1-design.md`、`docs/releases.md`。

## 待实施时手工确认

- `☆` / `★` 字形在 Windows 与统信 UOS 的 CJK 字体栈里是否存在并被正确渲染。自动化只能断言字符与状态，断言不了字形存在。
