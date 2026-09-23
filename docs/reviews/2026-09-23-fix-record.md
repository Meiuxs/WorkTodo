# WorkTodo 审查修复记录

## 修复批次：2026-09-23

### 跨窗口编辑冲突

- `src/dashboard/editor-autosave.js`
  - 增加外部变更到达时立即 flush 的入口，清除待执行防抖计时器并沿用现有保存状态机。
- `src/dashboard/task-editor.js`
  - 增加当前任务外部变更处理；冲突由既有冲突面板统一展示，其他错误继续交给全局错误处理。
- `src/dashboard/index.js`
  - 收到运行时任务变更消息时先通知编辑器，再刷新 Dashboard 控制器。
- `tests/services/editor-autosave.test.js`
  - 增加外部变更立即提交草稿的回归测试。

### 子任务级联版本一致性

- `src/domain/errors.js`
  - 增加共享 `ConflictError` 领域错误。
- `src/data/task-repository.js`
  - 保留原有 `ConflictError` 导出路径，避免破坏调用方和测试桩。
- `src/services/subtask-service.js`
  - 父任务完成和恢复均在处理子任务前校验 revision。
- `tests/services/subtask-service.test.js`
  - 增加过期父 revision 不得修改子任务的测试，并覆盖父任务级联恢复、无已完成子任务恢复和子任务自身恢复。

### 测试稳定性

- `playwright.config.js`
  - Windows 默认 worker 限制为最多 3 个，避免持久化 Chromium 进程过量争抢 CPU 导致交互断言偶发超时。

### UX 与安全复核

- 复核 `src/dashboard/index.html`、`src/dashboard/index.css`、`src/popup/`、动态反馈和确认对话框：未发现新的阻断级 UX/a11y 问题。
- 复核 Manifest V3、权限、CSP、运行时网络边界、用户输入渲染和发布包 allowlist：均通过。
- 保留工作区已有的用户改动和预览/截图目录，没有执行回滚或清理。

### 后续 UX 优化批次

- `src/dashboard/index.html`、`src/dashboard/task-editor.js`、`src/dashboard/index.css`
  - 描述、开始时间、截止时间和列表改为首屏平铺；标签改为常驻入口与按需展开的选择器；重复规则、资料和子任务保留低频折叠。
  - 计划控件统一网格、控件高度、边框与间距，390px 下自动单列。
- `src/dashboard/views/today-view.js`
  - 今日空状态移除重复的“记录第一件事”按钮，仅保留顶部快速记录入口，并清理已删除入口对应的残留回调。
- `src/dashboard/list-patch.js`
  - 相邻焦点恢复使用 `focus({ preventScroll: true })`，避免列表动作后视口被焦点恢复带动。
- `tests/e2e/task-editor-first-screen.spec.js`、`tests/e2e/design-consistency.spec.js`、`tests/e2e/ux-refactor.spec.js`、`tests/e2e/editor-conflict.spec.js`
  - 补充平铺字段、标签键盘操作、统一控件网格、空状态唯一入口、列表滚动和冲突校验回归覆盖。
- 对比度复核保留现有 `--muted` 令牌：当前值已满足项目记录的 WCAG AA 对比度，因此没有为了视觉加深而破坏文字层级。

### 文案精简收尾

- `src/dashboard/index.html`
  - 删除“先填标题和计划日期，其他可以稍后补。”，让字段层级承担引导职责。
- `src/dashboard/views/today-view.js`
  - 将“日期 + 排序规则”说明收敛为仅显示日期和星期，保留上下文但去掉开发说明感。
- `tests/e2e/editor-conflict.spec.js`、`tests/e2e/design-consistency.spec.js`
  - 增加冗余文案不回归的断言。

## 验证记录

| 检查 | 结果 |
|---|---:|
| `npm test` | 单元 240/240；E2E 共享 129/129、冲突 2/2 |
| `node --check` | `src/` 53 个 JavaScript 文件通过 |
| `npm run package` | 待 v1.9.0 发布构建完成后回填 |
| `npm run verify:package` | 60 个允许文件、Manifest V3、CSP、权限通过 |
| `npm run preview:edge` | 待 v1.9.0 发布构建完成后回填 |

## 备注

本轮已按业务/数据、安全/发布、测试/运行时、UX/无障碍角色拆分审查；并行代理未返回可用结果，最终报告以主工作流直接取得的 CodeGraph、源码、测试和打包证据为准。
