# Task R3 报告

## 改动

- `TaskRepository` 新增 `findByOccurrenceKey()` 和 `createIfOccurrenceAbsent()`，使用唯一 occurrenceKey 查询并在 IndexedDB 唯一约束冲突时返回已存在实例。
- `InMemoryTaskRepository` 补齐同等查询与幂等创建语义。
- `RecurringService` 新增 `generateNext()` 和 `complete()`：完成重复实例后按模板规则创建下一实例，携带 `seriesId`/`occurrenceKey`，并通过模板 active 状态和仓库幂等边界避免重复。
- 新增服务与仓库契约测试，覆盖完成生成、重复生成幂等和 occurrenceKey 查询。

## 测试结果

- `node --test tests/services/recurring-service.test.js tests/services/repository-contract.test.js`：26/26 通过。
- `node --test tests/services/backup-service.test.js tests/services/repository-contract.test.js`：42/42 通过。
- `npm run test:unit`：176/176 通过。

## Concerns

- R3 未改动 UI、取消/停用路由或端到端测试；这些由后续任务负责。
- IndexedDB 的并发冲突依赖 `occurrenceKey` 唯一索引；非 `ConstraintError` 会继续抛出，不会被吞掉。
