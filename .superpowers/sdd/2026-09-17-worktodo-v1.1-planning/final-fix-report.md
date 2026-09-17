# Final Fix Report

BASE: `d9152850a4551f4ee23cb22bb645be5599587167`

## 实现

1. `StatisticsService.#range()` 先从 `plannedTasks` 建立任务映射，只读取计划事件引用但不在该映射中的 taskId；补读结果与第一批任务合并后仍只保留 `trashedAt === null`。计划、完成、取消、延期和完成率口径未改变。
2. Data Experience 计划已与 R3 仓库接口对齐：
   - D2 增加 `TaskRepository.listTrashed()` 契约，要求使用 `trashedAt` 索引且不调用任务 store 全表 `getAll()`。
   - `TaskQueryService.trashed()` 改为调用 `repository.listTrashed()`，不再引用不存在的 `#tasks()`。
   - 永久删除事务扩展为 `tasks/events/searchIndex`，任务永久删除时同步 `searchIndex.delete(id)`。
   - D2 测试明确断言永久删除后搜索索引记录消失，并校验 readwrite 事务 store 范围。
   - D3 `TaskQueryService.all()` 改为调用现有 `repository.list()`。
3. 在真实 Chromium 扩展页面和真实 IndexedDB 中增加 10,000 条任务门槛：
   - 使用产品 `TaskRepository.replaceAll()` 写入并生成真实搜索索引。
   - 调用真实 `TaskRepository.search('批量任务')`，断言 10,000 个 ID 的完整顺序。
   - 调用真实 `StatisticsService.daily()`，断言 `createdCount`、`plannedCount`、`completedCount`、`plannedCompletedCount` 和 `completionRate`。
   - 测试超时设为 120 秒，不使用耗时毫秒断言，不将 10,000 条任务渲染到 Dashboard。

## RED / GREEN

- Statistics RED：新增回归测试后，旧实现调用 `getMany(['planned', 'event-target'])`；断言期望仅补读 `['event-target']`，测试失败。
- Statistics GREEN：改为先建立 `plannedTasks` 映射、再补读缺失事件任务后，`node --test tests/services/statistics-service.test.js` 通过。
- Plan RED：接口一致性检查因计划仍包含 `this.#tasks()`，且缺少 `listTrashed()` / `searchIndex.delete(id)` 契约而失败。
- Plan GREEN：更新计划后，检查 `this.#tasks()` 不存在，并确认 `trashedAt` 索引、`searchIndex.delete(id)` 和 `repository.list()` 契约均存在。
- Real-IDB 门槛：单独运行的 10,000 条 Chromium 测试在 4.3 秒内通过。

## 测试结果

- `node --test tests/services/statistics-service.test.js`：13/13 PASS。
- `npm test`：148 个 unit tests PASS；34 个 Playwright E2E PASS。
- `npx playwright test tests/e2e/database-upgrade.spec.js tests/e2e/planning.spec.js`：19/19 PASS。
- `git diff --check`：无空白错误。
- 真实 IDB 门槛测试名称：`真实 IndexedDB 10,000 条任务可正确搜索和统计`。

## 改动文件

- `docs/superpowers/plans/2026-09-17-worktodo-v1.1-data-experience.md`
- `src/services/statistics-service.js`
- `tests/services/statistics-service.test.js`
- `tests/e2e/planning.spec.js`
- `.superpowers/sdd/2026-09-17-worktodo-v1.1-planning/final-fix-report.md`

未修改可选的 `tests/e2e/database-upgrade.spec.js`，真实 IDB 大样本测试放入 `planning.spec.js`。

## 自审

- 计划文本已搜索确认不含 `this.#tasks()`，D2/D3 引用的接口均为当前 R3 仓库或查询服务接口。
- `listTrashed()` 计划实现使用 `trashedAt` 索引，并配套索引读取和结果集合断言。
- 永久删除计划同时覆盖任务、事件和搜索索引，并校验事务 store 范围。
- 真实 IDB 测试使用产品仓库，不依赖内存仓库、mock IndexedDB 或毫秒阈值。
- 测试通过 Playwright fixture 的独立临时 profile 隔离，运行前后不会影响其他 E2E。
- 未改动备份 JSON 形状、Manifest 权限、离线行为或运行时代码路径；除统计服务修复外，其余改动为计划/测试文本同步。

## 遗留

- Data Experience D2-D6 尚未实现；`listTrashed()`、永久删除、回收站视图和 CSV 导出仍是后续计划任务，本次只修复计划契约与大样本验证门槛。
- 未发现本次范围内的未闭合问题。
