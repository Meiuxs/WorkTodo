# WorkTodo 桌面端低摩擦任务流实施计划

> **For agentic workers:** 本计划在当前独立工作树中由主代理按任务逐项执行。每个任务先写失败测试、确认失败，再写最小实现并回归验证；不提交代码。

**Goal:** 在桌面 Chromium 环境中降低 WorkTodo 的核心任务流摩擦：已有任务自动保存、今日页首屏优先展示任务、任务行外露高频动作、Toast 固定在桌面右下角。

**Architecture:** 新增一个无 DOM 的自动保存状态机，隔离防抖、排队、冲突和关闭前冲刷逻辑；任务编辑器只负责把表单 draft 接入该状态机并呈现状态。今日页、任务行和 Toast 延续现有视图—控制器—服务边界，不改领域模型、仓库接口或路由。

**Tech Stack:** Manifest V3、原生 HTML/CSS/JavaScript、IndexedDB、Node.js 内置测试、Playwright E2E；不新增运行时依赖。

**Spec:** `docs/superpowers/specs/2026-09-22-worktodo-desktop-ux-design.md`

## Global Constraints

- 正式支持环境是桌面 Chromium 扩展页面；移动端不是本次产品目标。
- 已有任务自动保存；新建任务继续使用明确的创建动作。
- 现有 `taskService.edit(id, changes, revision)` 和 revision 冲突校验是唯一任务写入边界。
- 不修改任务领域模型、IndexedDB schema、权限或外部网络行为。
- 保留现有离线、键盘、无障碍和深色主题能力。
- 不引入图标库、远程字体、CDN、FAB 或 Bottom Sheet。
- 自动保存成功只显示编辑器内联状态；Toast 只用于失败、冲突、恢复和撤销。
- 不把 390px 视口作为新增功能的验收标准；不主动删除现有窄屏兜底规则。

## Review Focus

- 保存请求期间连续修改标题、日期和标签：最终 draft 必须按顺序保存，不能被早先请求覆盖。
- 保存失败或 revision 冲突：抽屉必须保持打开，输入和恢复出口必须可见。
- 关闭抽屉时仍有防抖或进行中的保存：关闭动作必须先冲刷，失败时不得静默关闭。
- 新建任务和已有任务的提交语义：新建仍需显式创建，不能因为输入事件生成半成品任务。
- 桌面窄窗口下任务行快捷动作和 Toast：标题、状态、焦点和撤销按钮不能被遮挡或横向挤出。

---

### Task 1: 新增可测试的自动保存状态机

**Files:**
- Create: `src/dashboard/editor-autosave.js`
- Test: `tests/services/editor-autosave.test.js`

**Interfaces:**
- Consumes: `initial` draft、`save(draft)` 异步保存函数、可选 `equals`、`delay`、计时器注入和 `onStateChange`。
- Produces: `createEditorAutosave(options)`，返回 `reset(initial)`, `update(draft)`, `flush()`, `cancel()`, `getState()`。
- `save(draft)` 成功时返回保存后的 baseline；失败时原样抛出错误。
- 状态事件形状为 `{ state: 'idle'|'dirty'|'saving'|'saved'|'error'|'conflict', error?: Error }`。

- [ ] **Step 1: 写失败测试——输入变化在防抖后只保存一次**

```javascript
test('draft 变化后经过防抖只保存最后一次', async () => {
  const timers = createManualTimers();
  const saved = [];
  const autosave = createEditorAutosave({
    initial: { title: '旧标题' },
    delay: 500,
    setTimeoutFn: timers.set,
    clearTimeoutFn: timers.clear,
    save: async (draft) => {
      saved.push(draft);
      return draft;
    },
  });

  autosave.update({ title: '新标题 1' });
  autosave.update({ title: '新标题 2' });
  assert.equal(saved.length, 0);
  timers.fireNext();
  await autosave.flush();

  assert.deepEqual(saved, [{ title: '新标题 2' }]);
  assert.equal(autosave.getState(), 'saved');
});
```

- [ ] **Step 2: 运行测试确认它按预期失败**

Run: `node --test tests/services/editor-autosave.test.js`

Expected: FAIL，因为 `src/dashboard/editor-autosave.js` 尚不存在。

- [ ] **Step 3: 写最小实现**

实现 `createEditorAutosave`：

```javascript
export function createEditorAutosave({
  initial,
  save,
  equals = (left, right) => JSON.stringify(left) === JSON.stringify(right),
  delay = 500,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onStateChange = () => {},
}) {
  let baseline = initial;
  let draft = initial;
  let timer = null;
  let inFlight = null;
  let state = 'idle';

  function setState(next, error) {
    state = next;
    onStateChange({ state: next, ...(error === undefined ? {} : { error }) });
  }

  function schedule() {
    if (timer !== null) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      timer = null;
      void flush();
    }, delay);
  }

  async function flush() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    if (inFlight !== null) await inFlight;
    if (equals(draft, baseline)) return baseline;

    const snapshot = draft;
    setState('saving');
    inFlight = Promise.resolve().then(() => save(snapshot));
    try {
      const saved = await inFlight;
      baseline = saved;
      setState(equals(draft, baseline) ? 'saved' : 'dirty');
      if (!equals(draft, baseline)) return flush();
      return saved;
    } catch (error) {
      setState(error?.name === 'ConflictError' ? 'conflict' : 'error', error);
      throw error;
    } finally {
      inFlight = null;
    }
  }

  return {
    reset(next) { cancel(); baseline = next; draft = next; setState('idle'); },
    update(next) { draft = next; if (equals(draft, baseline)) { setState('idle'); return; } setState('dirty'); schedule(); },
    flush,
    cancel() { if (timer !== null) clearTimeoutFn(timer); timer = null; },
    getState: () => state,
  };
}
```

实现时保留不可变快照，避免调用方继续修改传入对象后影响正在保存的请求。

- [ ] **Step 4: 增加排队、错误和取消测试并运行**

新增测试：

```javascript
test('保存期间的新 draft 会在旧请求完成后继续保存', async () => {
  const firstResolve = deferred();
  const saved = [];
  const autosave = createEditorAutosave({
    initial: { title: 'A' },
    save: async (draft) => {
      saved.push(draft);
      if (saved.length === 1) return firstResolve.promise;
      return draft;
    },
    delay: 0,
  });

  autosave.update({ title: 'B' });
  const first = autosave.flush();
  autosave.update({ title: 'C' });
  firstResolve.resolve({ title: 'B' });
  await first;

  assert.deepEqual(saved, [{ title: 'B' }, { title: 'C' }]);
  assert.equal(autosave.getState(), 'saved');
});

test('保存失败保留 dirty 状态并把冲突区分为 conflict', async () => {
  const conflict = Object.assign(new Error('revision 过期'), { name: 'ConflictError' });
  const states = [];
  const autosave = createEditorAutosave({
    initial: { title: 'A' },
    save: async () => { throw conflict; },
    onStateChange: ({ state }) => states.push(state),
    delay: 0,
  });

  autosave.update({ title: 'B' });
  await assert.rejects(autosave.flush(), conflict);
  assert.equal(autosave.getState(), 'conflict');
  assert.ok(states.includes('saving'));
  assert.ok(states.includes('conflict'));
});
```

Run: `node --test tests/services/editor-autosave.test.js`

Expected: PASS for all state-machine tests。

### Task 2: 将自动保存接入任务编辑抽屉

**Files:**
- Modify: `src/dashboard/task-editor.js:25-480`
- Modify: `src/dashboard/index.html:90-170`
- Modify: `src/dashboard/index.css:860-940`（编辑器状态样式所在区域）
- Modify: `tests/e2e/editor-conflict.spec.js`
- Modify: `tests/e2e/design-consistency.spec.js`
- Test: `tests/e2e/task-editor-autosave.spec.js`

**Interfaces:**
- Consumes: Task 1 的 `createEditorAutosave`、现有 `onUpdate(taskId, changes, revision)` 和 `onReload(taskId)`。
- Produces: 已有任务的 `data-editor-save-state` 状态文本、关闭前 flush、自动冲突面板；新建任务仍使用 `保存任务` 主按钮。

- [ ] **Step 1: 写失败 E2E——已有任务修改后无需点击保存即可持久化**

```javascript
test('已有任务修改后关闭即可自动保存', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '自动保存前');
  await dashboard.getByRole('button', { name: '自动保存前', exact: true }).click();

  const editor = dashboard.locator('#task-editor');
  await editor.getByLabel('任务名称').fill('自动保存后');
  await expect(editor.locator('[data-editor-save-state]')).toHaveText('已保存', { timeout: 3000 });
  await dashboard.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(dashboard.getByRole('button', { name: '自动保存后', exact: true })).toBeVisible();
});
```

- [ ] **Step 2: 运行测试确认它失败**

Run: `npx playwright test tests/e2e/task-editor-autosave.spec.js --project=chromium`

Expected: FAIL，因为当前已有任务仍需要点击“保存任务”，并且没有 `data-editor-save-state`。

- [ ] **Step 3: 接入状态机并区分新建/已有任务**

在 `createTaskEditor` 中：

1. 引入 `createEditorAutosave`。
2. 增加 `saveState` 节点和 `data-editor-submit` 钩子。
3. `openTask` 用 `readChanges()` 作为 baseline，隐藏“保存任务”按钮，重置状态为 idle。
4. `openNew` 取消自动保存，显示“保存任务”按钮，保留新建和重复任务逻辑。
5. `input` / `change` 事件在已有任务模式调用 `autosave.update(readChanges())`，仍然刷新折叠摘要和星标文案。
6. 自动保存回调调用 `onUpdate(currentTask.id, draft, currentTask.revision)`，成功后以返回任务更新 `currentTask` 和标题，返回 draft 作为新的 baseline。
7. `close()` 在已有任务模式先 `await autosave.flush()`；flush 失败时保留抽屉打开并返回 `false`。
8. `force: true` 的复制、重新载入和冲突恢复路径先取消待保存计时器，避免关闭后迟到请求改写任务。
9. 仅新建任务调用原有 `save()`；已有任务的表单 submit 只触发 `autosave.flush()`，不关闭抽屉。
10. 删除已有任务的 `confirmDiscard` 分支；新建任务仍使用“放弃未保存的修改？”确认。

保存状态映射：

```javascript
const SAVE_STATE_LABELS = Object.freeze({
  idle: '',
  dirty: '等待保存',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败，请重试',
  conflict: '发生冲突，请选择恢复方式',
});
```

冲突状态复用现有 `data-editor-conflict` 面板，焦点落到“载入最新版本”；普通失败把焦点落到状态文本或第一个字段错误。

- [ ] **Step 4: 更新抽屉 HTML 和 CSS**

在 `drawer-header` 中加入：

```html
<span class="editor-save-state" data-editor-save-state role="status" aria-live="polite"></span>
```

给已有任务隐藏的 footer 提交按钮加 `data-editor-submit`，不删除新建任务的提交能力。状态样式使用 `--muted`，失败和冲突使用现有语义色，但不得只依赖颜色。

- [ ] **Step 5: 更新现有 E2E 并运行专项测试**

把“已有任务点击保存”的测试改为等待“已保存”后关闭；保留新建任务和重复任务的显式保存测试。并发冲突测试改为修改后等待自动保存触发冲突，不再点击“保存任务”。

Run: `npx playwright test tests/e2e/task-editor-autosave.spec.js tests/e2e/editor-conflict.spec.js tests/e2e/design-consistency.spec.js`

Expected: PASS；新建任务按钮仍可见，已有任务按钮隐藏，关闭失败时抽屉保持打开。

### Task 3: 压缩今日页首屏

**Files:**
- Modify: `src/dashboard/views/today-view.js:30-155`
- Modify: `src/dashboard/index.css:212-265`
- Test: `tests/e2e/today-desktop-layout.spec.js`
- Modify: `tests/e2e/ux-refactor.spec.js`
- Modify: `tests/e2e/task-lifecycle.spec.js`

**Interfaces:**
- Consumes: 现有 `summary`, `overdue`, `planned` 数据和 `updateTodaySummary` patch 流程。
- Produces: 紧凑 `.today-focus`，标题区、进度条、下一步仍可访问且任务列表进入首屏主要区域。

- [ ] **Step 1: 写失败 E2E——今日任务列表应早于下一步大块区域出现**

```javascript
test('1280px 今日页优先给任务列表留出首屏空间', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 1280, height: 800 });
  await createTodayTask(dashboard, '首屏任务');

  const list = dashboard.locator('#today-list');
  const quickAdd = dashboard.locator('#quick-add');
  const summary = dashboard.locator('.today-focus');
  const listBox = await list.boundingBox();
  const summaryBox = await summary.boundingBox();
  const quickBox = await quickAdd.boundingBox();

  expect(listBox.y).toBeLessThan(700);
  expect(summaryBox.height).toBeLessThan(132);
  expect(quickBox.y).toBeLessThan(listBox.y);
});
```

- [ ] **Step 2: 运行测试确认它失败**

Run: `npx playwright test tests/e2e/today-desktop-layout.spec.js --project=chromium`

Expected: FAIL，因为当前摘要区包含较高的“下一步”分栏，任务列表首屏位置和高度不满足约束。

- [ ] **Step 3: 调整视图结构**

把今日摘要渲染为单一紧凑行：

```html
<section class="today-focus" aria-label="今日推进摘要">
  <div class="today-summary__metric"><span class="eyebrow">今日进度</span><strong>0 / 0</strong></div>
  <div class="progress-block"><span class="eyebrow">暂无计划</span><progress ...></progress></div>
  <div class="today-summary__next" data-next-action>...</div>
</section>
```

保留现有 `updateTodaySummary` 查询钩子和 `data-next-task` 行为，只将“下一步”改为横向轻量信息，不改变数据排序、逾期列表或 patch 逻辑。

- [ ] **Step 4: 调整桌面 CSS**

在桌面默认样式中：

- `.today-focus` 使用单行 grid 或 flex，减少上下 padding。
- `.today-summary` 不再占据宽度的一整块大区域。
- `.progress-block` 限制为紧凑宽度和细轨道。
- `.today-summary__next` 去掉大面积左侧分隔空间，使用短文本和省略号。
- `.view-root` 与任务列表之间保留一个明确但较小的间距。

不新增移动端专用布局，不删除现有窄屏兜底。

- [ ] **Step 5: 运行布局和生命周期测试**

Run: `npx playwright test tests/e2e/today-desktop-layout.spec.js tests/e2e/ux-refactor.spec.js tests/e2e/task-lifecycle.spec.js`

Expected: PASS；完成任务、撤销、空状态和下一步点击行为不回归。

### Task 4: 外露任务行高频动作并固定桌面 Toast

**Files:**
- Modify: `src/dashboard/task-list.js:80-218`
- Modify: `src/dashboard/index.css:629-710,1435-1480`
- Modify: `src/dashboard/index.js:105-129`
- Test: `tests/services/dashboard-task-list.test.js`
- Test: `tests/e2e/task-quick-actions.spec.js`
- Modify: `tests/e2e/design-consistency.spec.js`
- Modify: `tests/e2e/data-experience.spec.js`

**Interfaces:**
- Consumes: 现有 `set-starred`、`reschedule`、`getScheduleOptions` 和 `onAction` 委托。
- Produces: 每条活动任务的 `.task__quick-actions`，包含星标切换和一个明确日期快捷动作；更多菜单继续承载低频操作。

- [ ] **Step 1: 写失败单元测试和 E2E**

单元测试先锁定渲染契约，新增导出函数 `taskQuickActionLabels(task, today)`：

```javascript
test('活动任务提供星标和一个日期快捷动作', () => {
  assert.deepEqual(taskQuickActionLabels(task({ scheduledDate: '2026-09-17', starred: false }), '2026-09-17'), {
    star: '加星标',
    schedule: '安排明天',
    date: '2026-09-18',
  });
});
```

E2E：

```javascript
test('任务行悬停或键盘聚焦时可一步星标和改期', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await createTodayTask(dashboard, '快捷操作任务');
  const row = dashboard.locator('[data-task-id]').filter({ hasText: '快捷操作任务' });
  await expect(row.locator('.task__quick-actions')).toBeVisible();
  await row.getByRole('button', { name: '加星标：快捷操作任务' }).click();
  await expect(dashboard.getByText('已加星标')).toBeVisible();
  await row.getByRole('button', { name: '安排明天：快捷操作任务' }).click();
  await expect(dashboard.getByText(/已安排到/)).toBeVisible();
});
```

- [ ] **Step 2: 运行测试确认它失败**

Run: `node --test tests/services/dashboard-task-list.test.js && npx playwright test tests/e2e/task-quick-actions.spec.js --project=chromium`

Expected: 单元测试找不到 `taskQuickActionLabels`，E2E 找不到 `.task__quick-actions`。

- [ ] **Step 3: 实现快捷动作标记和渲染**

在 `task-list.js` 中新增：

```javascript
export function taskQuickActionLabels(task, today) {
  const tomorrow = getScheduleOptions(today).find((option) => option.label === '明天');
  const target = task.scheduledDate === today
    ? tomorrow
    : getScheduleOptions(today).find((option) => option.label === '今天');
  return {
    star: task.starred ? '取消星标' : '加星标',
    schedule: target === undefined ? '改期' : target.label === '今天' ? '安排今天' : '安排明天',
    date: target?.value ?? '',
  };
}
```

在活动任务、非回收站行的更多菜单旁渲染：

```html
<div class="task__quick-actions" aria-label="常用任务操作">
  <button type="button" data-action="set-starred" data-starred="true" aria-label="加星标：任务标题">加星标</button>
  <button type="button" data-action="reschedule" data-date="2026-09-18" aria-label="安排明天：任务标题">安排明天</button>
</div>
```

按钮必须复用现有事件委托，不新增第二套服务调用。完成/恢复继续由行首圆环承担。

- [ ] **Step 4: 调整桌面 CSS 和 Toast 位置**

`.task__quick-actions` 默认对精确指针设备透明，任务行悬停、内部聚焦或键盘聚焦时显示；非精确指针设备不新增移动端专门行为，但应保留可访问 DOM 顺序。快捷动作按钮使用低权重边界，不使用 emoji 或外部图标。

将 `.toast` 从正文列底部居中改为右下角：

```css
.toast {
  right: var(--sp-6);
  bottom: var(--sp-6);
  left: auto;
  transform: none;
  max-width: min(420px, calc(100vw - var(--sp-8)));
}
```

同步调整进入动画，避免继续使用居中 `translateX(-50%)`。保留现有 Toast `role`、撤销按钮和主题颜色。

- [ ] **Step 5: 运行动作、反馈和服务回归测试**

Run: `node --test tests/services/dashboard-task-list.test.js && npx playwright test tests/e2e/task-quick-actions.spec.js tests/e2e/design-consistency.spec.js tests/e2e/data-experience.spec.js`

Expected: PASS；快捷动作使用现有服务、菜单仍能打开、星标 Toast 文案保持明确、桌面 Toast 位于右下角且不覆盖任务操作。

### Task 5: 全量验证、桌面预览和收尾检查

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-worktodo-desktop-ux-design.md` only if implementation decisions require a precise correction.
- Modify: `docs/reviews/2026-09-22-fix-record.md` only if the repository’s existing review record is the designated place for this change.

**Interfaces:**
- Consumes: Tasks 1–4 的自动保存、布局、快捷动作和反馈实现。
- Produces: 全量测试、打包校验、桌面 Edge 预览结果和工作树状态报告；不提交代码。

- [ ] **Step 1: 运行完整自动化测试**

Run: `npm test`

Expected: 所有单元测试和 E2E 测试通过；若现有移动视口测试仍通过，保留它们作为不回归证据，但不扩展移动端功能。

- [ ] **Step 2: 运行打包与包内容校验**

Run: `npm run package`

Expected: 生成与 `manifest.json` 版本一致的 `dist/WorkTodo-v<version>.zip`。

Run: `npm run verify:package`

Expected: Manifest V3、权限、CSP、ZIP allowlist 和包名版本校验全部通过。

- [ ] **Step 3: 启动 Edge 桌面预览并执行随机验证**

Run: `npm run preview:edge`

在桌面预览中随机验证：

1. 新建一个收集箱任务，确认仍需明确创建且创建成功。
2. 打开已有任务，修改标题、日期、优先级和标签，观察“保存中 → 已保存”，关闭后重新打开确认数据持久化。
3. 在保存状态出现时快速连续修改标题，确认最终标题是最后一次输入。
4. 完成任务、撤销完成、星标、安排明天，确认 Toast 位于右下角且文案明确。
5. 切换深色主题，确认保存状态、快捷动作、Toast 和焦点环仍清楚。
6. 用 Tab、Enter、Space 和 Escape 完成编辑、关闭和快捷动作路径。

- [ ] **Step 4: 检查工作树和完成证据**

Run: `git status --short; git diff --check; git diff --stat`

Expected: 只包含本次任务相关的未提交文件，无测试残留、无无关锁文件变化、无打包产物误加入源码变更。

