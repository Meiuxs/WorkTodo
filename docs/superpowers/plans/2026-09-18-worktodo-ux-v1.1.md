# WorkTodo V1.1 UX 优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 UX 规格优化 WorkTodo 的核心用户旅程，使记录、规划、处理和回顾的下一步更明确。

**Architecture:** 保留现有服务层和数据模型，仅调整 Dashboard 壳、视图模板、任务编辑器、Popup 文案/布局和共享设计令牌。新增交互逻辑优先抽成小型纯函数并先写 node:test，再用 Playwright 验证真实用户旅程。

**Tech Stack:** Manifest V3、原生 HTML/CSS/JavaScript、IndexedDB、Node.js `node:test`、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-18-worktodo-ux-v1.1-design.md`

## Global Constraints

- 运行时不依赖服务器、网络、Node.js、npm 或第三方 CDN。
- 主数据继续使用 IndexedDB，设置继续使用 `chrome.storage.local`。
- 目标平台继续为 Chromium 110+、统信 UOS、ARM64。
- 所有核心流程支持离线、键盘操作和非颜色化状态表达。
- 不改变现有任务、标签、子任务和重复模板的数据契约。
- 不引入构建步骤、CSS 框架或无关权限。

## 文件分工

- `src/dashboard/index.html`：导航分组、跳过链接和编辑器结构。
- `src/dashboard/index.js`：页面级焦点、快速新增反馈和导航状态。
- `src/dashboard/index.css`：导航、今日页、抽屉和回顾页的视觉层级。
- `src/dashboard/views/today-view.js`：今日主线、逾期提示和空状态。
- `src/dashboard/views/history-view.js`：回顾页结论优先和总结渐进展开。
- `src/dashboard/task-editor.js`：编辑器分段、字段渐进展开和焦点恢复。
- `src/popup/popup.html|css|js`：Popup 的成功反馈和工作台入口。
- `src/shared/ux.js`：可测试的旅程文案、分组和优先级辅助函数。
- `tests/services/ux.test.js`：纯 UX 辅助函数测试。
- `tests/e2e/planning.spec.js`、`tests/e2e/popup-dashboard.spec.js`、`tests/e2e/organization.spec.js`：真实旅程回归。

### Task 1: 建立 UX 辅助契约与失败测试

**Files:**
- Create: `src/shared/ux.js`
- Test: `tests/services/ux.test.js`

**Interfaces:**
- `NAV_GROUPS`：返回计划、任务、回顾、系统分组及现有 route id。
- `getQuickAddFeedback({ scheduledDate, undoneCount })`：返回保存成功后的用户文案。
- `shouldShowSummaryEditor(value)`：只有有总结内容时返回 true。

- [ ] 写失败测试，覆盖分组顺序、收集箱/日期反馈和空总结判断。
- [ ] 运行 `node --test tests/services/ux.test.js`，确认模块不存在或断言失败。
- [ ] 实现最小辅助模块，不读取 DOM、不依赖浏览器 API。
- [ ] 重新运行该测试并确认通过。
- [ ] 提交 `test: define UX journey contracts`。

### Task 2: 重构 Dashboard 导航与快速新增反馈

**Files:**
- Modify: `src/dashboard/index.html`
- Modify: `src/dashboard/index.js`
- Modify: `src/dashboard/index.css`
- Test: `tests/services/dashboard-controller.test.js`
- Test: `tests/e2e/popup-dashboard.spec.js`

**Interfaces:**
- 复用现有 `data-route`，只增加分组语义，不新增路由。
- 快速新增成功后通过 `getQuickAddFeedback` 渲染文案和撤销按钮。

- [ ] 写失败测试，验证分组标记存在、保存后反馈包含下一动作。
- [ ] 运行目标测试确认失败。
- [ ] 添加“今天/计划/任务/回顾/系统”导航组和当前页语义。
- [ ] 优化快速新增的按钮层级、日期选择和成功反馈。
- [ ] 在 390px 与桌面视口验证无溢出和焦点不丢失。
- [ ] 提交 `feat: clarify dashboard navigation and capture flow`。

### Task 3: 优化今日页的行动层级

**Files:**
- Modify: `src/dashboard/views/today-view.js`
- Modify: `src/dashboard/task-list.js`
- Modify: `src/dashboard/index.css`
- Test: `tests/e2e/task-lifecycle.spec.js`
- Test: `tests/e2e/responsive.spec.js`

**Interfaces:**
- 保持现有 `onAction`、`onEdit` 和任务服务接口。
- 任务行继续输出文字状态、完成按钮和更多菜单。

- [ ] 写失败 E2E，验证今日页有逾期提示、明确的下一步区域和可恢复空状态。
- [ ] 运行目标 E2E 确认失败。
- [ ] 重排今日页区块，逾期有明确标题，主任务列表保持低噪音。
- [ ] 优化任务行主要/次要动作的视觉和键盘顺序。
- [ ] 验证完成、延期、取消和撤销流程不变。
- [ ] 提交 `feat: sharpen today action hierarchy`。

### Task 4: 优化任务编辑器的渐进展开

**Files:**
- Modify: `src/dashboard/index.html`
- Modify: `src/dashboard/task-editor.js`
- Modify: `src/dashboard/index.css`
- Test: `tests/e2e/editor-conflict.spec.js`
- Test: `tests/e2e/organization.spec.js`
- Test: `tests/e2e/planning.spec.js`

**Interfaces:**
- 保持 `createTaskEditor` 的现有回调契约。
- 保持 `readChanges()` 输出字段不变；只调整字段分区、默认展开状态和文案。

- [ ] 写失败 E2E，验证新增任务默认隐藏高级字段而高级字段仍可打开。
- [ ] 运行目标 E2E 确认失败。
- [ ] 把编辑器分为“基本信息/组织/更多信息”，重复规则文案改为用户语言。
- [ ] 保持标签、子任务、重复任务创建和冲突恢复。
- [ ] 验证 Esc、校验失败和保存后焦点恢复。
- [ ] 提交 `feat: make task editing progressive`。

### Task 5: 优化 Popup 与工作记录旅程

**Files:**
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.css`
- Modify: `src/popup/popup.js`
- Modify: `src/dashboard/views/history-view.js`
- Modify: `src/dashboard/index.css`
- Test: `tests/e2e/popup-dashboard.spec.js`
- Test: `tests/e2e/planning.spec.js`

**Interfaces:**
- Popup 继续通过现有 `PopupController` 保存任务，不新增权限。
- History 继续调用现有 `SummaryService`，只改变显示时机和层级。

- [ ] 写失败 E2E，验证 Popup 保存后有明确工作台入口、工作记录初始状态不显示大空白编辑器。
- [ ] 运行目标 E2E 确认失败。
- [ ] 增加 Popup 的“继续处理”路径和成功反馈。
- [ ] 将总结文本框改为生成后显示，保留复制和错误反馈。
- [ ] 验证深色模式、键盘操作和小视口。
- [ ] 提交 `feat: connect popup and review journeys`。

### Task 6: 整体视觉收口与验收

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/base.css`
- Modify: `src/dashboard/index.css`
- Modify: `src/popup/popup.css`
- Create: `docs/acceptance/v1.1-ux-acceptance-report.md`

- [ ] 运行全套 `npm test`，确保单元和 E2E 全部通过。
- [ ] 运行现有 UI 审计脚本，确认对比度、字号阶梯、焦点和溢出无回归。
- [ ] 用真实 Chrome 检查 Dashboard、Popup、编辑器、回顾页的浅色/深色与 390px 状态。
- [ ] 写入逐项验收报告和已知限制。
- [ ] 提交 `docs: add v1.1 UX acceptance report`。

## 完成门槛

- 每个任务的失败测试确实先失败，再由实现使其通过。
- `npm test` 全部通过。
- 无外部网络请求、无新增 Manifest 权限。
- 规格中的五段用户旅程均有真实 E2E 证据。
- 验收报告已提交且 `main` 工作树干净（忽略本地工具产物）。
