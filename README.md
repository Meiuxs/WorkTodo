# WorkTodo

WorkTodo 是一个无需构建的 Manifest V3 浏览器扩展。扩展运行时不依赖 Node、npm 或网络资源。

开发期需要 Node.js 20+ 仅用于运行测试；目标用户不需要安装 Node.js 或 Playwright。

## 本地测试

1. 运行 `npm ci` 安装开发期测试依赖。
2. 运行 `npm run test:unit` 执行 Node 内置单元测试。
3. 运行 `npm run test:e2e` 在隔离的 Chromium 持久化配置中加载扩展并执行浏览器测试。
4. 运行 `npm test` 串行执行单元测试和 E2E。任一步失败都会返回非零退出码。

Windows 下 E2E 默认使用 Microsoft Edge。可通过 `PLAYWRIGHT_CHANNEL` 指定其他 Chromium 渠道，或通过 `CHROME_PATH` 指定浏览器可执行文件。需要观察交互时可将 `HEADLESS_EXTENSION` 设为 `false`。

开发期视觉预览可在仓库根目录运行 `python -m http.server 4173`，然后打开 `http://127.0.0.1:4173/tests/browser/dashboard-preview.html`。该页面使用轻量浏览器 API 替代层，只用于检查界面，不作为产品运行方式。

测试证据见 `docs/testing/v1.0-test-matrix.md`，发布验收记录见 `docs/acceptance/v1.0-checklist.md`。

## UI 设计规范

- 设计规范：[WorkTodo v1.5 UX/UI 设计规范](docs/superpowers/designs/2026-09-17-worktodo-ui-design.md)。这里维护用户任务流、信息架构、视觉令牌、Popup、任务编辑抽屉、确认对话框、Toast、响应式和无障碍约束。
- 交互评审入口：[UX 评审入口](docs/review-index.md)。涉及布局、弹窗或任务流程的修改，先对照该入口和设计规范检查。
- 运行时代码使用 [设计令牌](src/styles/tokens.css)，颜色、间距、圆角、字号和浮层阴影不要在页面样式中重复发明。

### 全局弹窗约定

- Popup 只负责快速记录和少量今日重点；任务详情使用 Dashboard 右侧抽屉。
- 删除、永久删除、覆盖导入和有风险的状态确认统一使用产品内 `dialog`，不使用浏览器原生确认框。
- Toast 必须是非阻塞反馈，不能遮挡输入、日期选择或移动端底部操作；需要撤销时提供明确文字按钮。
- 长表单对话框限制在视口内滚动，打开后聚焦首个有效字段，关闭后恢复触发元素焦点。
- 这套规则已同步记录在根目录 [`AGENTS.md`](AGENTS.md)，后续实现和评审以该文件与设计规范为准。

## 加载已解压扩展

1. 打开 Chrome 的 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本仓库根目录。
4. 点击扩展图标打开 Popup；通过扩展入口打开 Dashboard，并确认开发者工具没有 CSP 或模块错误。
