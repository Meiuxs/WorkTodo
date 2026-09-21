# 回收站行动作与「清除所有数据」设计规格

> 状态：待复核
> 日期：2026-09-21
> 依据：`docs/superpowers/designs/2026-09-17-worktodo-ui-design.md`
> 关联：[侧栏导航与设置入口](2026-09-20-sidebar-navigation-design.md)

## 1. 目标

两件事，同属「把不必要的层级拆掉」：

1. **回收站行不再套「更多」菜单。** 已删除任务的行内动作恒定只有「永久删除」一个，`<details>` 菜单只为单个动作服务，用户必须多一次展开才能到达唯一可做的事。
2. **设置页新增「清除所有数据」。** 目前清空本地数据只能靠卸载扩展或覆盖导入一份空备份，前者连偏好一起丢，后者反直觉。补一个明确、可确认、有反馈的入口。

## 2. 现状与问题

### 2.1 回收站行的菜单恒为一项

`src/dashboard/task-list.js:80-86`：

```js
function taskActions(task, today) {
  const actions = [];
  if (task.trashedAt !== null) {
    actions.push('<button type="button" data-action="delete-permanently">永久删除</button>');
    return actions.join('');
  }
```

已删任务走 `return` 提前退出：编辑、复制、移入回收站一律不加。紧接着 `task-list.js:166-171` 仍然渲染完整的 `<details class="task__more">` 外壳，于是形成「展开一个菜单，里面只有一个按钮」。

### 2.2 「清除所有数据」没有入口

- 设置页的数据管理区（`src/dashboard/views/settings-view.js:253-271`）只有三个动作：导出 JSON 备份、导出 CSV、选择导入文件。
- 用户想清空本地数据，现实里只有两条路：卸载扩展（`settings-view.js:255` 的说明文字承认了这一点），或自己造一份空备份再走「覆盖导入」。
- 设计文档 §2.1 给「设置」定的职责是"数据如何保存和迁移"，并明确禁止"把危险操作做成无确认的一键动作"——**缺的是入口，不是确认**。

## 3. 决定

### 3.1 已删行直接渲染「永久删除」（否决保留菜单）

被否决的方案：

- **保留菜单但只放一项**：维持现状。否决理由是本规格要解决的问题本身。
- **把「永久删除」改成图标按钮或长按触发**：破坏性动作变得更难发现，与「本地可信」（AGENTS.md 设计原则 5）要求的"数据风险用平实文字说明"相悖。
- **在已删行同时提供「恢复」按钮**：恢复已由行首圆环承担（`task-list.js:156-159`），加第二个入口会让同一动作出现两次，正是 `taskActions()` 注释里已经避免过的重复。

### 3.2 「清除所有数据」只清业务数据，保留偏好

**清除范围**：`tasks`、`categories`、`tags`、`events`、`recurringTemplates`、`searchIndex`（IndexedDB）与 `resources`、`taskResources`、`resourceBlobs`（IndexedDB），以及 `chrome.storage.local` 里的 `metadata`（导入/导出时间戳）。

**保留范围**：`chrome.storage.local` 里的 `settings`（主题等偏好）一个字段都不动。

被否决的方案：

- **连偏好一起重置（回到刚安装状态）**：语义更干净，但主题会当场变回"跟随系统"，用户会以为自己误触了别的东西。偏好是"在这台机器上我怎么看"，不是"我的工作数据"。
- **保留回收站里的已删任务**：多一层需要用户再手动清空的残留状态，而回收站本身也是业务数据。
- **让用户上传一份空备份走「覆盖导入」**：把清空伪装成导入，反直觉。
- **强制先导出 JSON 才允许清除**：给只想清空的用户多一道没有收益的墙。改为在确认框里写明建议导出。
- **在设置页单独开一个「危险操作」节**：该页目前只有四节，为一个按钮新开一节会放大它的视觉重量。改为留在数据管理区内，用分隔线把它和三个安全动作隔开。

### 3.3 版本号按 MINOR 递增

`1.7.2` → `1.8.0`。依据 AGENTS.md「版本与 GitHub 发布」：新增向后兼容的用户功能属 MINOR。（回收站行改动本身属 PATCH 级的细节优化，但同批发布取较高者。）

## 4. 设计

### 4.1 回收站行：去掉菜单外壳

`task-list.js` 的 `taskMarkup()` 在 `trashed === true` 时不渲染 `<details class="task__more">`，改为直接渲染行内按钮：

```html
<button class="task__danger" type="button" data-action="delete-permanently">永久删除</button>
```

- 行网格 `34px minmax(0, 1fr) auto`（`index.css:266-274`）的第三列本来就为空，按钮直接落进去，**不改任何网格定义**。
- 新增 `.task__danger`：尺寸沿用「更多」的 `min-height: var(--control-h-sm)` 与 `--fs-caption`，文字色 `--coral`、hover 背景 `--coral-soft`。这与 `index.css:553-557` 给菜单内破坏性按钮用的令牌完全一致，因此深浅两套主题自动跟随。
- `data-action="delete-permanently"` 不变，`src/dashboard/index.js:186-191` 的「永久删除任务？」二次确认不变。

影响面已被收窄到回收站一个视图，验证如下：

| 关注点 | 结论 | 依据 |
|---|---|---|
| 会不会出现在其他视图 | 不会 | `range()` 过滤 `trashedAt === null`（`src/services/task-query-service.js:213`），全部任务走 `search()` 同样过滤（`:331`）；月历/周/今天/明天都经 `range()`。唯一渲染点是 `src/dashboard/views/trash-view.js:21` |
| `D` 快捷键 | 无需修改 | `task-list.js:285-287` 已有 `if (details === null \|\| firstDate === null) return;`，已删行天然 no-op |
| `P` 快捷键 | 不受影响 | 优先级锚点 `data-action="cycle-priority"` 由 `taskMarkup` 无条件渲染（`task-list.js:155`） |

**代价**：破坏性动作从两步变一步可达。保护仍然存在（二次确认框），且只发生在回收站里——那里的每一条本来就是用户已经决定要删的东西。

### 4.2 服务层：`BackupService.clearAllData()`

新增方法，复用 `#replaceImport()` 已验证的"先取恢复点、失败回滚"模式（`src/services/backup-service.js:422-452`）：

1. `exportAll()` 取任务侧恢复点；`resourceRepository.exportAll()` 取资料侧恢复点（若注入了该仓库）。
2. 用空快照落库：`{ tasks: [], categories: [], events: [], tags: [], recurringTemplates: [] }`，资料侧 `{ resources: [], taskResources: [] }`。`replaceAll` 会先 `clear()` 六个 store（`src/data/task-repository.js:494-503`），资料仓库同理清三个 store（`src/data/resource-repository.js:208-214`）。
3. `saveMetadata({})` —— 元数据整体置空，符合"连导出元数据一起清"的范围约定。
4. 任意一步失败：用恢复点回滚两侧数据后抛出，**本机原有数据保持不变**。
5. `settings` 全程不读写，因此天然保留。

方法放在 `BackupService` 而不是新服务：该类已经同时持有 `#repository`、`#resourceRepository`、`#settingsRepository`，且已经在做跨 store 的原子替换（`#mergeImport` / `#replaceImport`），清空是同一类操作，新服务只会重复注入同一组依赖。

### 4.3 视图层：数据管理区的危险动作

`settings-view.js` 的数据管理节新增，与现有 `.data-actions` 分开：

- 一个独立区块（`.view-section--danger` 里的 `.danger-zone`），位于设置页最下方，整块用 `1px solid var(--coral)` 边界包围、标题用 `--coral`，把危险动作和「导出 JSON 备份 / 导出 CSV / 选择导入文件」三个安全按钮分开在不同屏幕位置。
- 后续修订（见主设计文档 §4.13）：危险动作不再留在数据管理区里的 `.data-danger` 分隔线下方，而是独立成「危险区域」区块；数据管理区只保留三个安全动作。
- 一句说明文案，交代清除范围与保留项，让用户在点之前就知道会发生什么。
- 按钮 `class="button-danger"`（`index.css:648-650` 已有，hover 用更深的 `--coral-strong`），文案「清除所有数据」。
- 结果反馈复用现有 `#data-state` 区域（`role="status"`）。

### 4.4 视图层：确认对话框

新增 `<dialog class="modal" id="clear-all-dialog">`，严格按设计文档 §4.5：

| §4.5 要求 | 本对话框的实现 |
|---|---|
| 标题直接说明风险 | 「清除所有数据？」 |
| 说明影响和恢复可能性 | 正文写明清除什么、保留什么，并注明"清除后无法恢复，也不能撤销。建议先导出 JSON 备份。" |
| 危险按钮用明确动作名 | 「清除所有数据」，不使用「确认」 |
| 默认焦点落在取消 | 打开后 `[value="cancel"]` 获得焦点 |
| Esc 可取消 | 原生 `<dialog>` + `<form method="dialog">` |

### 4.5 交互时序

1. 点「清除所有数据」→ 打开确认框，焦点在取消。
2. 取消 → 关闭并**焦点回到触发按钮**，什么都不发生。
3. 确认 → `DataManagementController.clearAll()`：状态置 `clearing`（提示"正在清除本地数据…"），成功后置 `result`（"已清除全部本地数据；主题等偏好设置已保留。"），失败置 `error`（"清除没有完成，本机原有数据保持不变。"）。
4. 成功后调用 `onDataChanged()`（即 `controller.refresh()`），整页重渲染设置页——列表区变空、`#data-state` 显示结果文案。`dataController` 是 `createSettingsView` 的闭包变量，跨渲染存活，因此结果文案能在重渲染后保留。

## 5. 规范冲突与取代

### 5.1 与 §4.8 的补充（非冲突）

§4.8 描述的是任务行菜单的排序与内容规则，**没有覆盖"菜单里只剩一个动作"这种情况**。本次在 §4.8 追加一条：回收站行只有「永久删除」一个动作，因此不渲染菜单，直接作为行内按钮呈现；破坏性色与二次确认要求不变。

### 5.2 与 §2.1 的关系（补充，不取代）

§2.1 给设置页写的禁忌是"把危险操作做成无确认的一键动作"。本规格新增的正是**带确认**的入口，与该条一致，因此不改写它。

### 5.3 新增 §4.12「设置页数据管理」

规范此前没有描述设置页的数据管理区。新增一节，记录：动作集合与排序、危险动作与安全动作用分隔线隔开、清除范围（业务数据 + 元数据，保留偏好）、确认框要求、清除后的反馈文案。

### 5.4 无冲突但需注意

`tests/services/backup-service.test.js:88-100` 构造 `BackupService` 时不传 `resourceRepository`，因此 `clearAllData()` 必须容忍该依赖为 `null`（与 `createBackup()`、`#mergeImport()` 的现有写法一致）。

## 6. 验收

### 6.1 键盘

- 回收站行 Tab 顺序变为：行首圆环 → 标题 → 永久删除。到达破坏性动作比现在少一次展开操作。
- `D` 在回收站行仍是 no-op（不得因此报错或跳到别处）；`P` 行为不变。
- 确认框：Tab 只在框内循环，默认焦点在取消，`Esc` 关闭且不执行任何删除。
- 取消关闭后焦点回到「清除所有数据」按钮。

### 6.2 读屏

- 回收站行不再有 `aria-haspopup` / `aria-expanded`；「永久删除」是可访问名明确的普通按钮。
- 行首圆环保持 `aria-label="恢复任务"`（`data-experience.spec.js:148` 已在断言），不受本次改动影响。
- 确认框标题、说明、危险按钮名都可读；`#data-state` 结果通过 `role="status"` 播报。

### 6.3 对比度

- `.task__danger` 的文字用 `--coral`：浅色 `#c23f22` 在表层 `#fbfaf7` 上 4.99:1（`src/styles/tokens.css:23-24` 已记录），深色 `#ff9a82` 在 `#162a28` 上对比度更高。与菜单内破坏性按钮同源，无新增配色。
- `--coral` / `--coral-soft` / `--coral-strong` 在 `tokens.css:24-27` 与 `:133-135` 成对定义，深色主题自动跟随。`.task__danger` 不得引入新的裸色值。

### 6.4 窄屏（390px）与缩放

- 窄屏行网格为 `30px minmax(0, 1fr) auto`（`index.css:1174`），按钮落在 `auto` 列，标题列仍可收缩，不得出现横向溢出。
- 200% 缩放：人工确认侧栏与设置页无横向滚动、危险按钮可点击。Playwright 无法设置浏览器缩放，对 `<html>` 施加 CSS `zoom` 会改变 `scrollWidth` / `clientWidth` 的语义，因此不写成自动化断言（沿用侧栏规格的同一决定）。

### 6.5 深色主题

- `.task__danger` 与 `button-danger` 在深色下均使用成对令牌，需实测 hover 与静止态都可见。

### 6.6 静态与能力

- 不新增权限，不发起网络请求，不引入第三方资源或图标（`dialog`、`button-danger` 均为现有能力）。
- 清除是纯本地操作，`chrome.storage.local` 只写 `metadata`，不写任务数组（`settings-repository.js:12-20` 的断言仍然成立）。

## 7. 文档与测试回写

- **设计规范** `docs/superpowers/designs/2026-09-17-worktodo-ui-design.md`：§4.8 追加回收站行规则；新增 §4.12「设置页数据管理」；头部更新日期改为 2026-09-21。
- **单元测试** `tests/services/backup-service.test.js`：新增
  1. 清除后任务侧六个集合与资料侧集合为空、`metadata` 置空、`settings` 原样保留；
  2. `replaceAll` 抛错时用恢复点回滚，数据与元数据均不变；
  3. 未注入 `resourceRepository` 时不报错。
- **端到端测试** `tests/e2e/data-experience.spec.js`：
  1. 改写现有「回收站可以恢复任务，永久删除任务需要二次确认」（`:96-104`）——不再展开菜单，直接点行内按钮；
  2. 新增：回收站行不含 `summary[aria-label="更多任务操作"]`，且「永久删除」直接可见；
  3. 新增：清除所有数据——先在取消分支断言数据未变，再确认清除，断言任务与回收站清空、主题保持、`#data-state` 有结果文案。
- **发布记录** `docs/releases.md`：按既有六项格式追加 v1.8.0 条目（版本号、变更摘要、测试结果、包文件名、GitHub Release 链接、tag）。
- **README**：不涉及（其中没有数据管理或任务行动作的描述，已核对）。

## 8. 范围边界

明确不做：

1. 不给已删行加第二个「恢复」入口（恢复仍由行首圆环承担）。
2. 不改「全部任务」、月历、周、今天等视图的行渲染——它们本就不含已删任务。
3. 不做部分清除（按时间范围、按列表、只清回收站）。
4. 不提供撤销：清除本身不可逆，兜底手段是清除前导出备份的提示。
5. 不改 `importBackup()` 的 merge / replace 行为，也不动导入确认框。
6. 不新增"危险操作"独立分节，也不为设置页重排章节顺序。
