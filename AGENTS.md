# WorkTodo 项目协作说明

## Design Context

### Users

单人知识工作者，主要在受限办公环境中使用 Chromium，例如工程技术、项目、销售和行政人员。核心工作是用几秒记录临时事项，早上看清今日任务，处理完成、延期或取消，并在之后回顾实际完成的工作。

### Brand Personality

轻快、清晰、高效。界面应让人感到工作在向前推进，但不制造紧张感；文案简短、直接、有行动指向。

### Aesthetic Direction

采用“清透网格”方向：薄荷灰与暖白为底色，深墨绿文字，青绿色作为完成与行动色，橙珊瑚色只用于逾期和需要注意的事项。使用结构化网格、细边界和轻微层级差建立秩序，不使用霓虹渐变、玻璃拟态、发光装饰或堆叠卡片。Popup 强调快速记录，Dashboard 强调今日主线。

### Design Principles

1. **三秒记录**：首要输入框永远容易找到，快速新增只要求标题。
2. **一眼看清**：今日页只突出逾期、下一步和完成进度，低频功能渐进展开。
3. **轻而有序**：用网格、留白和清楚的文字层级代替装饰性组件。
4. **行动可恢复**：完成、延期、取消和删除都给出清晰反馈与可回退路径。
5. **本地可信**：状态、保存、导入和数据风险都用平实文字说明。

## UI 设计规范引用

- 统一设计规范：[docs/superpowers/designs/2026-09-17-worktodo-ui-design.md](docs/superpowers/designs/2026-09-17-worktodo-ui-design.md)。
- 交互评审入口：[docs/review-index.md](docs/review-index.md)。
- 运行时设计令牌：[src/styles/tokens.css](src/styles/tokens.css)。
- Popup、任务编辑抽屉、确认对话框、资料表单和 Toast 必须按设计规范分层；不得新增浏览器原生 `window.confirm`、遮挡主操作的 Toast 或超出视口的长表单弹窗。
- 若实现与规范冲突，先更新规范和 README 的说明，再修改组件，并补充对应的键盘、响应式和无障碍验收。

## Engineering Constraints

- 目标平台：Chromium 110+、统信 UOS、ARM64。
- 扩展使用 Manifest V3、原生 HTML/CSS/JavaScript 和浏览器内置 API。
- 产品运行时不依赖服务器、网络、Node.js、npm 或第三方 CDN。
- 不声明与功能无关的权限，不读取网页内容、浏览历史、密码、Cookie 或剪贴板。
- 任务主数据使用 IndexedDB；`chrome.storage.local` 仅保存设置和轻量元数据。
- 所有核心流程必须支持离线、键盘操作和非颜色化状态表达。

## Packaging

- 使用 `npm run package` 生成可导入 Chromium 的扩展压缩包。
- 打包脚本读取 `manifest.json` 的版本号，输出到 `dist/WorkTodo-v<version>.zip`。
- 发布包只包含 `manifest.json` 和 `src/`，不包含测试、文档、`node_modules` 或开发工具。
- 生成的压缩包解压后，在 Chromium 的扩展管理页开启“开发者模式”，选择“加载已解压的扩展程序”，指向解压目录即可安装。
- 修改运行时代码或 `manifest.json` 后，先运行 `npm test`，再运行 `npm run package`。

## 版本与 GitHub 发布

- 每次准备发布时，都根据本次变更内容升级 `manifest.json` 的版本号；`manifest.json` 是扩展发布版本的唯一来源，`package.json` 的版本号不作为扩展包版本依据。
- 版本号遵循语义化版本：
  - `PATCH`（例如 `1.5.1`）：修复 Bug、兼容性问题、细节优化，且不增加新的主要用户能力。
  - `MINOR`（例如 `1.6.0`）：新增向后兼容的用户功能、页面能力或数据展示能力。
  - `MAJOR`（例如 `2.0.0`）：包含不兼容变更，例如数据结构无法平滑迁移、核心行为改变、权限模型改变或需要用户重新配置。
- 每次发布必须同时完成以下事项：
  1. 更新 `manifest.json` 版本号，并运行 `npm test` 与 `npm run package`。
  2. 确认只包含本次任务相关的改动，用中文提交信息提交代码。
  3. 将提交推送到 GitHub 默认分支。
  4. 创建与版本号一致的带注释 tag，格式为 `v<version>`，例如 `v1.5.0`，并推送到 GitHub。
  5. 在 GitHub Releases 页面创建同名 Release，上传 `dist/WorkTodo-v<version>.zip`，并填写本次变更说明。
  6. 发布后核对默认分支提交、tag、Release 和附件名称/版本号一致，并确认工作区干净。
- 发布记录至少包含版本号、变更摘要、测试结果、包文件名、GitHub Release 链接和 tag 名称；后续发布不得复用已有版本号、tag 或 Release。

## Git 提交规范

- Git commit message 必须使用中文，简洁说明本次变更的目的或结果。
- 推荐格式：`类型：变更内容`，例如 `修复：资料副本导入时的校验问题`。
- 类型可使用：`新增`、`修复`、`优化`、`重构`、`测试`、`文档`、`构建`、`合并`。
- 提交前确认只包含当前任务相关文件，并在可行时运行对应测试。

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Use the single-context layout with root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
