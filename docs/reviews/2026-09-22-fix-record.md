# WorkTodo 审查修复记录

## 修复批次

### 数据层与服务层

- `src/data/resource-repository.js`
  - 资料删除事务补齐 `resourceBlobs`。
  - 资料关联事务验证目标任务存在。
  - 支持内部恢复点导出 Blob，保留普通 JSON 导出的轻量行为。
- `src/data/task-repository.js`
  - 永久删除在事务内清理任务事件、搜索索引和资料关联。
  - 父任务仍有子任务时拒绝永久删除。
- `src/services/backup-service.js`
  - merge 导入补齐资源 Blob 恢复点与失败回滚。
  - 合并本机资料时保留已有文件副本。
  - 复用重复模板、资料和任务时间字段校验。
- `src/domain/task.js`
  - 补充结束/取消/回收时间的 ISO 时间校验。
- `src/services/task-service.js`
  - 复制任务接收编辑器当前内容，并重算首次计划日期。
- `src/services/subtask-service.js`、`src/services/recurring-service.js`
  - 级联完成和重复任务生成失败时执行补偿恢复。
  - 返回下一实例是否由本次操作新建，供撤销链路准确清理。

### Dashboard、Popup 与 UX

- `src/dashboard/task-editor.js`、`src/dashboard/index.js`
  - 复制保留当前编辑值。
  - 异步复制、重载、导航和快速新增入口统一处理异常。
  - 重复任务撤销删除本次新建的下一实例。
- `src/dashboard/task-list.js`、`src/popup/popup.js`
  - 动作名称带上任务标题。
  - 子任务快捷键不再误操作父任务。
- `src/dashboard/views/resources-view.js`、`src/dashboard/resource-picker.js`
  - 资料校验错误聚焦到对应输入。
  - 增加表单错误关联。
- `src/dashboard/views/today-view.js`
  - 为完成率进度条增加可访问名称。
- `src/dashboard/index.css`
  - 保留清透网格视觉，仅扩大任务完成按钮的操作命中区域，不改变完成/恢复的非颜色状态表达。
- `src/dashboard/index.html`
  - 资料选择器错误信息增加稳定 ID 与字段关联。

### 测试与工程

- 新增“复制使用当前编辑内容并重置首次计划日期”单元测试。
- 扩展重复任务完成测试，断言 `nextTaskCreated`。
- 扩展仓库测试桩，覆盖 `taskResources` 事务和父任务删除保护。
- 更新受可访问名变化影响的 E2E 断言，使用精确的“动作：任务名”语义。
- `package.json`、`package-lock.json` 增加 Node.js `>=20`。
- `scripts/package.mjs` 将发布包生成改为跨平台 Node.js 实现，保持只打包 `manifest.json` 与 `src/`。
- `scripts/verify-package.mjs` 增加 Manifest V3、权限、CSP、ZIP allowlist 和包名版本一致性校验。
- `.github/workflows/quality.yml` 在 Linux/Node.js 20 上自动执行测试、Chromium 安装、打包和包策略校验。
- `manifest.json` 升级至 `1.8.1`，并同步回填发布记录、tag、Release 和附件 SHA-256。

## 验证记录

| 检查 | 结果 |
|---|---:|
| 单元测试 | 227/227 通过 |
| E2E 测试 | 116/116 通过 |
| JavaScript 语法检查 | 52/52 通过 |
| 扩展打包 | 通过 |
| 包内文件 allowlist | 通过 |
| Edge 预览启动 | 通过 |

发布包：`WorkTodo-v1.8.1.zip`，141,292 字节，SHA-256 为 `3785DD29D8CEB7D399C40B9B0379DB12AE942BF1B9FDBE9EE3D715F06AA75644`。

## 发布结果

- 已提交并推送 `main`。
- 已创建带注释 tag `v1.8.1`。
- 已创建 GitHub Release：<https://github.com/Meiuxs/WorkTodo/releases/tag/v1.8.1>。
- 已将 `.qoder/`、测试结果目录和运行日志加入忽略规则，没有删除已有用户文件。
