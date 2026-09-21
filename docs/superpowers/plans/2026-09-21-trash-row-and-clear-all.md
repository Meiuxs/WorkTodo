# 回收站行动作与「清除所有数据」实施计划

> 依据：`docs/superpowers/specs/2026-09-21-trash-row-and-clear-all-design.md`
> 分支：`main`（用户已确认）
> 目标终态：单元测试全通过、端到端全通过、`dist/WorkTodo-v1.8.0.zip` 产出

**执行约定**

- 所有端到端命令必须带 `--output`，且每个任务用**唯一目录**。仓库根的 `test-results/` 里堆积的历史文件会让 Playwright 启动时的目录清理被沙箱批量删除保护拦下。
- 每个任务结束前必须跑完该任务列出的验证命令，并把结果写进已完成证据，不得只凭"看起来对"提交。
- 单元测试命令：`npm run test:unit`；全量端到端：`npx playwright test --output=...`。

---

## Task 1：回收站行去掉「更多」菜单

**Files**

- Modify: `tests/e2e/data-experience.spec.js`
- Modify: `src/dashboard/task-list.js`
- Modify: `src/dashboard/index.css`

- [ ] **Step 1: 写失败测试**

`tests/e2e/data-experience.spec.js` 中已有用例「回收站可以恢复任务，永久删除任务需要二次确认」。把第 96-104 行（从 `await row.getByText('更多', ...)` 到第二次点击「永久删除」）改成直接点行内按钮：

```js
  await row.getByRole('button', { name: '永久删除' }).click();
  const confirmation = page.locator('#confirm-dialog');
  await expect(confirmation.getByRole('heading', { name: '永久删除任务？' })).toBeVisible();
  await confirmation.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('button', { name: '待删除任务' })).toBeVisible();
  await row.getByRole('button', { name: '永久删除' }).click();
  await confirmation.getByRole('button', { name: '永久删除' }).click();
  await expect(page.getByRole('button', { name: '待删除任务' })).toHaveCount(0);
```

同时删掉原来那句「取消确认后行菜单会随"点外收起"一起关闭，重试需重新展开」的注释——菜单已经不存在，`confirmAction` 会把焦点还给触发按钮，无需重新展开。

在文件末尾追加新用例：

```js
test('回收站行直接展示永久删除，不再套更多菜单', async ({ extension }) => {
  const page = await openDashboard(extension);
  await seedTrashedTasks(page, [trashedTask({
    id: 'trashed-row',
    title: '回收站行',
    lifecycle: 'todo',
    trashedAt: '2026-09-17T10:00:00.000Z',
  })]);
  await page.getByRole('button', { name: '回收站', exact: true }).click();

  const row = page.locator('[data-task-id="trashed-row"]');
  // 唯一动作不再藏在菜单里。
  await expect(row.locator('summary[aria-label="更多任务操作"]')).toHaveCount(0);
  await expect(row.getByRole('button', { name: '永久删除', exact: true })).toBeVisible();
  // 恢复仍由行首圆环承担，不得出现第二个恢复入口。
  await expect(row.locator('.task__check')).toHaveAttribute('data-action', 'untrash');
  await expect(row.getByRole('button', { name: '恢复任务', exact: true })).toHaveCount(1);

  // 破坏性色必须在行所在的表层上满足 AA，深浅两套主题都不例外。
  // 断言比值而不是写死 rgb：写死会在主题切换或令牌调整时假失败。
  const colors = await row.evaluate((node) => ({
    danger: getComputedStyle(node.querySelector('.task__danger')).color,
    surface: getComputedStyle(document.querySelector('.content')).backgroundColor,
  }));
  expect(contrastRatio(colors.danger, colors.surface)).toBeGreaterThanOrEqual(4.5);
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `npx playwright test tests/e2e/data-experience.spec.js --output="$env:TEMP\worktodo-pw-t1a"`

Expected: 2 个用例失败——改写的那个在 `row.getByRole('button', { name: '永久删除' })` 处超时（按钮还在菜单里，未展开时不可见），新用例在 `toHaveCount(0)` 处失败（菜单外壳仍在）。

- [ ] **Step 3: 改 `taskActions()`：给按钮带上类名**

`src/dashboard/task-list.js:82-86` 的已删分支改成：

```js
  if (task.trashedAt !== null) {
    // 恢复由行首圆环按钮承担；这里只剩低频的破坏性动作，且不再套菜单外壳——
    // 单个动作藏进「更多」要多一次展开，直接作为行内按钮更好。
    actions.push('<button type="button" class="task__danger" data-action="delete-permanently">永久删除</button>');
    return actions.join('');
  }
```

- [ ] **Step 4: 改 `taskMarkup()`：已删行不渲染菜单外壳**

`src/dashboard/task-list.js:166-171` 的 `<details class="task__more">` 整块替换为：

```js
  const moreMarkup = trashed
    ? taskActions(task, today)
    : `<details class="task__more">
      <summary aria-label="更多任务操作" aria-haspopup="true" aria-expanded="false">更多</summary>
      <div class="task__menu">
        ${taskActions(task, today)}
      </div>
    </details>`;
```

并把模板里的那三行 `<details>` 块替换为 `${moreMarkup}`。变量声明位置放在 `checkAttributes` 之后、`return` 之前。

- [ ] **Step 5: 加 `.task__danger` 样式**

`src/dashboard/index.css` 中，在 `.task__title:hover` 之前（任务行一组的末尾，第 310 行附近）插入：

```css
/* 已删行只剩「永久删除」一个动作，因此不套菜单：它直接占行尾那一列。
   尺寸沿用「更多」触发器，只把颜色换成破坏性色，
   否则破坏性动作和普通操作外形完全一样。 */
.task__danger {
  display: inline-flex;
  align-items: center;
  min-height: var(--control-h-sm);
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--coral);
  padding: 0 var(--sp-3);
  font-size: var(--fs-caption);
  cursor: pointer;
}
.task__danger:hover { border-color: var(--line); background: var(--coral-soft); }
```

- [ ] **Step 6: 清理菜单里已失效的 `delete-permanently` 选择器**

永久删除不再出现在菜单中，`src/dashboard/index.css:554-557` 与 `:568-573` 两组的第二个选择器已成死声明。删掉这两处 `delete-permanently` 行，并更新第 567 行注释：

```css
/* 回收站入口是菜单里唯一的破坏性动作，用分隔线把它和日常操作隔开。 */
.task__menu button[data-action="trash"] {
```

保留 `[data-action="trash"]` 的全部行为不变，这是需要在这一步验证的点。

- [ ] **Step 7: 跑测试确认 GREEN**

Run: `npx playwright test tests/e2e/data-experience.spec.js --output="$env:TEMP\worktodo-pw-t1b"`

Expected: 全部通过，且其中「移入回收站」仍在菜单内带分隔线显示（既有用例在断言它）。

- [ ] **Step 8: 跑 `ux-refactor.spec.js` 与 `design-consistency.spec.js`**

Run: `npx playwright test tests/e2e/ux-refactor.spec.js tests/e2e/design-consistency.spec.js --output="$env:TEMP\worktodo-pw-t1c"`

Expected: 全部通过。`design-consistency.spec.js:37-45` 断言的是活动任务行的菜单内容，不受影响。

已知既有抖动：「完成任务后滚动位置与其他行菜单展开态保持」在 HEAD 上就有约 1/3 的失败率（渲染竞态：记录 `scrollBefore` 时第 8 行尚未渲染）。若它失败，重跑一次确认；连续两次失败才按回归处理。

- [ ] **Step 9: Commit**

```bash
git add src/dashboard/task-list.js src/dashboard/index.css tests/e2e/data-experience.spec.js
git commit -m "优化：回收站行直接展示永久删除，不再套更多菜单"
```

---

## Task 2：数据层 `clearAllData()`

**Files**

- Modify: `tests/services/backup-service.test.js`
- Modify: `src/services/backup-service.js`

- [ ] **Step 1: 写失败测试**

在 `tests/services/backup-service.test.js` 末尾追加三个用例。`createBackupService()` 已支持传入 `storage`，`InMemoryStorageArea` 提供 `set()` 与 `snapshot()`。

```js
test('清除所有数据清空业务数据但保留设置并清空 metadata', async () => {
  const storage = new InMemoryStorageArea();
  await storage.set({ settings: { theme: 'dark' }, metadata: { lastExportedAt: NOW } });
  const { backup, repo, restoreChrome } = createBackupService({
    tasks: [BASE_TASK],
    categories: [CATEGORY],
    events: [EVENT],
    tags: [TAG],
    recurringTemplates: [TEMPLATE],
    storage,
  });
  try {
    await backup.clearAllData();

    const snapshot = await repo.exportAll();
    assert.deepEqual(snapshot.tasks, []);
    assert.deepEqual(snapshot.categories, []);
    assert.deepEqual(snapshot.events, []);
    assert.deepEqual(snapshot.tags, []);
    assert.deepEqual(snapshot.recurringTemplates, []);

    const persisted = storage.snapshot();
    // 偏好是"在这台机器上我怎么看"，不属于业务数据。
    assert.deepEqual(persisted.settings, { theme: 'dark' });
    assert.deepEqual(persisted.metadata, {});
  } finally {
    restoreChrome();
  }
});

test('清除所有数据失败时回滚任务数据且不写 metadata', async () => {
  class FailingReplaceRepository extends InMemoryTaskRepository {
    async replaceAll(snapshot) {
      if ((snapshot.tasks ?? []).length === 0) throw new Error('事务失败');
      return super.replaceAll(snapshot);
    }
  }

  const storage = new InMemoryStorageArea();
  await storage.set({ settings: { theme: 'dark' }, metadata: { lastExportedAt: NOW } });
  const restoreChrome = installStorage(storage);
  const repo = new FailingReplaceRepository([BASE_TASK], [CATEGORY], [EVENT]);
  const backup = new BackupService(repo, { now: () => NOW, appVersion: '0.1.0' });
  try {
    await assert.rejects(() => backup.clearAllData(), /事务失败/);
    const snapshot = await repo.exportAll();
    assert.deepEqual(snapshot.tasks.map((task) => task.id), [SAME_ID]);
    assert.deepEqual(storage.snapshot().metadata, { lastExportedAt: NOW });
  } finally {
    restoreChrome();
  }
});

test('清除所有数据在未注入资源仓库时同样可用', async () => {
  const { backup, repo, restoreChrome } = createBackupService();
  try {
    await backup.clearAllData();
    assert.deepEqual((await repo.exportAll()).tasks, []);
  } finally {
    restoreChrome();
  }
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `npm run test:unit 2>&1 | Select-String -Pattern "clearAllData|清除所有数据|fail|pass"`

Expected: 三个新用例失败，错误为 `backup.clearAllData is not a function`。

- [ ] **Step 3: 实现 `clearAllData()`**

`src/services/backup-service.js` 中，把方法插在 `importBackup()`（第 384-393 行）之后、`#mergeImport()` 之前——公开方法放在一起，私有方法留在后面。

```js
  /* 清空全部业务数据，保留 chrome.storage.local 里的 settings。
     与 #replaceImport 同一套恢复点策略：任一步失败都回滚，
     避免留下"任务已清、资料还在"的半清状态。 */
  async clearAllData() {
    const recovery = await this.#repository.exportAll();
    const resourceRecovery = this.#resourceRepository?.exportAll
      ? await this.#resourceRepository.exportAll()
      : null;
    const emptySnapshot = {
      tasks: [],
      categories: [],
      events: [],
      tags: [],
      recurringTemplates: [],
    };
    try {
      await this.#repository.replaceAll(emptySnapshot);
      if (this.#resourceRepository?.replaceAll) {
        await this.#resourceRepository.replaceAll({ resources: [], taskResources: [] });
      }
      // 元数据整体置空：导出与导入的时间戳属于本次清除范围。
      await this.#settingsRepository.saveMetadata({});
    } catch (error) {
      await this.#repository.replaceAll(recovery);
      if (resourceRecovery !== null && this.#resourceRepository?.replaceAll) {
        await this.#resourceRepository.replaceAll(resourceRecovery);
      }
      throw error;
    }
  }
```

`replaceAll` 会自行 `clear()` 六个 store（`src/data/task-repository.js:494-503`），资源仓库同理清 `resources` / `taskResources` / `resourceBlobs`（`src/data/resource-repository.js:208-214`），因此空数组即彻底清空。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `npm run test:unit`

Expected: 全部通过，计数为 216 + 4 = 220。

- [ ] **Step 5: Commit**

```bash
git add src/services/backup-service.js tests/services/backup-service.test.js
git commit -m "新增：数据层支持清空全部业务数据并保留偏好"
```

---

## Task 3：设置页「清除所有数据」入口与确认框

**Files**

- Modify: `tests/e2e/data-experience.spec.js`
- Modify: `src/dashboard/views/settings-view.js`
- Modify: `src/dashboard/index.css`

- [ ] **Step 1: 写失败测试**

在 `tests/e2e/data-experience.spec.js` 末尾追加：

```js
test('清除所有数据需要确认，清除后业务数据清空而主题保留', async ({ extension }) => {
  const page = await openDashboard(extension);
  await page.getByLabel('记录一个新事项').fill('清除前任务');
  await page.locator('#quick-add-date').selectOption('today');
  await page.getByRole('button', { name: '记录', exact: true }).click();

  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('主题').selectOption('dark');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

  const trigger = page.locator('#clear-all-data');
  const confirmation = page.locator('#clear-all-dialog');

  await trigger.click();
  await expect(confirmation.getByRole('heading', { name: '清除所有数据？' })).toBeVisible();
  // 规范 §4.5：默认焦点落在安全动作上。
  await expect(confirmation.getByRole('button', { name: '取消' })).toBeFocused();

  // 取消分支：什么都不能被改动。
  await confirmation.getByRole('button', { name: '取消' }).click();
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: '今天' }).click();
  await expect(page.getByRole('button', { name: '清除前任务' })).toBeVisible();

  await page.getByRole('button', { name: '设置' }).click();
  await trigger.click();
  await confirmation.getByRole('button', { name: '清除所有数据' }).click();

  // 重渲染之后焦点回到清空按钮，而不是掉到 body。
  await expect(trigger).toBeFocused();
  await expect(page.locator('#data-state')).toContainText('已清除全部本地数据');
  await expect(page.getByLabel('主题')).toHaveValue('dark');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

  await page.getByRole('button', { name: '今天' }).click();
  await expect(page.getByRole('button', { name: '清除前任务' })).toHaveCount(0);
  await page.getByRole('button', { name: '回收站', exact: true }).click();
  await expect(page.locator('.empty-state__title')).toHaveText('回收站是空的');
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `npx playwright test tests/e2e/data-experience.spec.js --grep "清除所有数据" --output="$env:TEMP\worktodo-pw-t3a"`

Expected: 失败于 `#clear-all-data` 定位不到。

- [ ] **Step 3: 给 `DataManagementController` 加 `clearAll()`**

`src/dashboard/views/settings-view.js`，插在 `reset()` 之前：

```js
  /* 清除是不可逆动作，结果复用同一套 state，让 #data-state 统一播报。
     kind 用 clearing 而不是 importing —— 语义不同，不应互相借用。 */
  async clearAll() {
    this.#state = {
      kind: 'clearing',
      canConfirm: false,
      message: '正在清除本地数据…',
      preview: null,
      text: null,
    };
    try {
      await this.#backupService.clearAllData();
      this.#state = {
        kind: 'result',
        canConfirm: false,
        message: '已清除全部本地数据；主题等偏好设置已保留。',
        preview: null,
        text: null,
      };
    } catch (error) {
      this.#state = {
        kind: 'error',
        canConfirm: false,
        message: '清除没有完成，本机原有数据保持不变。',
        preview: null,
        text: null,
      };
    }
    return this.#state;
  }
```

- [ ] **Step 4: 加入口与确认框的 DOM**

`src/dashboard/views/settings-view.js` 的 `render()` 模板中，在 `<div class="data-actions" id="data-management">…</div>` 之后、`<div id="data-state"></div>` 之前插入：

```html
      <div class="data-danger">
        <p class="data-danger__hint">清除本机的全部工作数据，保留主题等偏好设置。</p>
        <button type="button" id="clear-all-data" class="button-danger">清除所有数据</button>
      </div>
```

并把现有 `<dialog class="modal" id="import-confirm">` 之后补上：

```html
      <dialog class="modal" id="clear-all-dialog">
        <form method="dialog">
          <h2>清除所有数据？</h2>
          <p>会删除全部任务、列表、标签、资料、重复规则和工作记录，并清空回收站。主题等偏好设置会保留。</p>
          <p>清除后无法恢复，也不能撤销。建议先导出 JSON 备份。</p>
          <div class="dialog-actions"><button value="cancel">取消</button><button class="button-danger" value="confirm">清除所有数据</button></div>
        </form>
      </dialog>
```

- [ ] **Step 5: 接线**

`src/dashboard/views/settings-view.js` 的 `render()` 中，在 `#import-file` 的 change 监听之后加：

```js
    const clearDialog = root.querySelector('#clear-all-dialog');
    const clearTrigger = root.querySelector('#clear-all-data');
    clearTrigger.addEventListener('click', () => {
      clearDialog.showModal();
      clearDialog.querySelector('[value="cancel"]')?.focus();
    });
    clearDialog.addEventListener('close', () => {
      // 规范 §4.5：关框后焦点回到触发它的控件。
      clearTrigger.focus();
      if (clearDialog.returnValue !== 'confirm') return;
      runViewAction(async () => {
        await dataController.clearAll();
        if (dataController.state.kind === 'result') {
          // 成功会整页重渲染，新的 #data-state 会读到 result 状态；
          // 但它也换掉了设置页 DOM，焦点会落回 body，所以把焦点还给清空后的同名按钮，
          // 键盘用户不会失去位置。注意这里刻意不复用 signal——重渲染已经把它中止了。
          await onDataChanged();
          root.querySelector('#clear-all-data')?.focus();
          return;
        }
        // 失败不触发重渲染，必须在这里就地播报 error。
        if (signal?.aborted) return;
        renderDataState(signal);
      }, { signal, onError });
    });
```

- [ ] **Step 6: 加 `.data-danger` 样式**

`src/dashboard/index.css` 的设置页一组内（`.data-actions { margin-top: var(--sp-5); }` 之后）：

```css
/* 清除所有数据是不可逆动作，与三个安全动作之间用分隔线断开，
   避免它挨着"导出 JSON 备份"被误点。 */
.data-danger {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
  margin-top: var(--sp-7);
  border-top: 1px solid var(--line);
  padding-top: var(--sp-5);
}
.data-danger__hint { margin: 0; color: var(--muted); font-size: var(--fs-caption); }
```

- [ ] **Step 7: 跑测试确认 GREEN**

Run: `npx playwright test tests/e2e/data-experience.spec.js --output="$env:TEMP\worktodo-pw-t3b"`

Expected: 全部通过。

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/views/settings-view.js src/dashboard/index.css tests/e2e/data-experience.spec.js
git commit -m "新增：设置页支持清除全部本地数据并保留偏好"
```

---

## Task 4：回写权威设计规范

**Files**

- Modify: `docs/superpowers/designs/2026-09-17-worktodo-ui-design.md`

按 AGENTS.md「先更新规范和 README 的说明，再修改组件」的顺序，本任务在代码落地后补齐规范正文（代码已在 Task 1-3 完成，规范与实现同日交付，不产生漂移）。

- [ ] **Step 1: §4.8 追加回收站行规则**

在 `src` 对应的规范位置——`docs/superpowers/designs/2026-09-17-worktodo-ui-design.md` 第 238 行（`- 菜单限高可滚…` 那条）之后插入：

```markdown
- 回收站行是例外：它的行内动作只有「永久删除」一个，因此不渲染「更多」菜单，直接把该动作作为行尾按钮呈现（`.task__danger`，尺寸与「更多」触发器一致，颜色用破坏性色）。恢复仍由行首圆环承担，不得为它再加第二个入口；永久删除的二次确认要求不因入口前移而改变。
```

- [ ] **Step 2: 新增 §4.12「设置页数据管理」**

在第 267 行（§4.11 最后一条）之后、`## 5.` 之前插入：

```markdown
### 4.12 设置页数据管理

数据管理区是设置页里唯一涉及数据风险的地方，动作集合固定为：导出 JSON 备份、导出 CSV、选择导入文件、清除所有数据。

- 清除所有数据是不可逆动作，必须与三个安全动作之间用分隔线隔开，不得与「导出 JSON 备份」并列成排，避免误点。
- 清除范围限定为业务数据：`tasks`、`categories`、`tags`、`events`、`recurringTemplates`、`searchIndex`、`resources`、`taskResources`、`resourceBlobs`，以及 `chrome.storage.local` 的 `metadata`。`settings`（主题等偏好）不在清除范围，也不得被顺带重置。
- 清除必须走 §4.5 的确认对话框：标题「清除所有数据？」，说明同时交代清除范围、保留项和"无法恢复、不能撤销"，危险按钮具名为「清除所有数据」，默认焦点落在取消。
- 不强制先导出备份；只允许在确认框里给出"建议先导出 JSON 备份"的提示。
- 清除结果复用数据管理区的 `role="status"` 区域播报：成功为「已清除全部本地数据；主题等偏好设置已保留。」，失败为「清除没有完成，本机原有数据保持不变。」且不得留下半清状态。
- 不提供撤销，也不新增按时间范围、按列表的部分清除能力。
```

- [ ] **Step 3: 更新头部日期**

第 4 行 `> 更新：2026-09-20` 改为 `> 更新：2026-09-21`。

- [ ] **Step 4: 校验**

Run: `Select-String -Path docs/superpowers/designs/2026-09-17-worktodo-ui-design.md -Pattern "更新：2026-09-21|### 4.12 设置页数据管理|task__danger|^## 5\." | ForEach-Object { "$($_.LineNumber): $($_.Line)" }`

Expected: 命中四行，且 `### 4.12` 的行号小于 `## 5.` 的行号。

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/designs/2026-09-17-worktodo-ui-design.md
git commit -m "文档：补充回收站行动作与设置页数据管理规范"
```

---

## Task 5：升级 1.8.0、全量回归与打包

**Files**

- Modify: `manifest.json`
- Modify: `docs/releases.md`

- [ ] **Step 1: 全量回归**

Run: `npm test 2>&1 | Select-Object -Last 40`

Expected: 单元测试 220 通过（基线 216 + 本次新增 4，比原计划多一条——「资料集合也被清空」这条声明原本没有测试承接）、端到端 95 通过（基线 92 + 本次新增 3：Task 1 一条、Task 3 一条、窄屏溢出一条；被改写的既有用例不计入新增）。

基线已于 2026-09-21 在 `1d923ff` 上实测：单元 216 通过、端到端 92 通过、全绿。端到端若只有「完成任务后滚动位置…」失败，重跑确认它是既有抖动（Task 1 Step 8 已记录判定方法）。

- [ ] **Step 2: 升级版本号**

`manifest.json` 的 `"version"` 从 `1.7.2` 改为 `1.8.0`。依据 AGENTS.md：新增用户功能属 MINOR。

- [ ] **Step 3: 人工验证 200% 缩放**

Run: 在 Chrome/Edge 打开扩展工作台，窗口宽度约 1280px，按 `Ctrl` + `+` 放大到 200%。

Expected: 设置页数据管理区不出现横向滚动条；分隔线可见；「清除所有数据」可点击并打开确认框。

这一条刻意不写成自动化断言：Playwright 无法设置浏览器缩放，对 `<html>` 施加 CSS `zoom` 会改变 `scrollWidth` / `clientWidth` 的语义，写出来的断言容易假阳性。这是本次唯一需要人工确认的验收项。

- [ ] **Step 4: 打包**

Run: `npm run package`

Expected: 产出 `dist/WorkTodo-v1.8.0.zip`。

- [ ] **Step 5: 补发布记录并提交**

`docs/releases.md` 在 v1.6.1 之上、按既有六项格式追加 v1.8.0 条目（版本号、变更摘要、测试结果、包文件名、GitHub Release 链接、tag 名称）。

```bash
git add manifest.json docs/releases.md
git commit -m "构建：升级到 v1.8.0 并生成发布包"
```

- [ ] **Step 6: 发布（需用户明确确认后执行）**

AGENTS.md 的发布流程包含推送、打 tag 和创建 GitHub Release。这三步对外可见且不可撤回，因此在执行前单独向用户确认一次：

```bash
git push origin main
git tag -a v1.8.0 -m "v1.8.0"
git push origin v1.8.0
gh release create v1.8.0 dist/WorkTodo-v1.8.0.zip --title v1.8.0 --notes "<本次变更说明>"
```

Expected: 默认分支提交、tag、Release 与附件名称一致；最后确认工作区干净。
