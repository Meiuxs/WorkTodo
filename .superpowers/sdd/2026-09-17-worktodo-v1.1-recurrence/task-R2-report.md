# Task R2 实现报告

## 改动

- 新增 `RecurringTemplateRepository`：支持模板与首个任务实例在同一 IndexedDB 事务中创建，并提供 `get`、`list`、`update`、`exportAll`。
- 新增 `RecurringService.createTemplate()`、`listTemplates()`、`getTemplate()`，统一创建模板、首个实例和 CREATE 事件，写入 `seriesId` 与 `occurrenceKey`。
- 新增 `InMemoryRecurringTemplateRepository` fake，支持模板快照和首实例持久化语义。
- 增加重复服务与仓库契约测试。
- 复用现有 v2 `recurringTemplates` 导出、合并、覆盖与 v1 升级为空数组逻辑；未改动现有 UI 未提交修改。

## 测试命令与结果

- `node --test tests/services/recurring-service.test.js`（RED 阶段先因缺少 `src/services/recurring-service.js` 失败；实现后通过）
- `node --test tests/services/recurring-service.test.js tests/services/repository-contract.test.js`：22/22 通过
- `node --test tests/services/backup-service.test.js tests/services/repository-contract.test.js tests/services/recurring-service.test.js`：42/42 通过
- `npm run test:unit`：172/172 通过

## Concerns

- 首个重复实例按计划通过模板仓库事务写入任务、事件和模板；搜索索引仍由后续任务仓库流程维护，R2 未扩展该派生索引写入。
- 内存模板 fake 在未显式传入任务仓库时复用最近创建的内存任务仓库，以匹配 R2 测试约定的分离构造方式；生产代码不依赖该测试辅助行为。
