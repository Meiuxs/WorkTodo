# WorkTodo Task Context Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在保持离线、低权限和三秒记录体验的前提下，为 WorkTodo 增加网页链接、本地文件元数据/副本、文本片段、资料收集箱和任务关联能力。

**Architecture:** 新增独立的 `resources` 与 `taskResources` IndexedDB store，使用 `ResourceRepository` 负责资料实体和关联事务，使用 `ResourceService` 负责类型校验、文件副本大小限制和删除语义。Dashboard 新增资料收集箱路由，任务编辑器通过资源选择器创建或关联资料；任务列表只展示资料数量，不加载 Blob。

**Tech Stack:** Manifest V3、原生 HTML/CSS/JavaScript、IndexedDB、Node.js `node:test`、Playwright E2E；不新增运行时依赖、网络请求或扩展权限。

**Spec:** `docs/superpowers/specs/2026-09-18-worktodo-context-resources-design.md`

## Global Constraints

- 目标平台：Chromium 110+、统信 UOS、ARM64。
- 产品运行时不依赖服务器、网络、Node.js、npm 或第三方 CDN。
- 不读取网页内容、浏览历史、密码、Cookie 或系统剪贴板。
- 任务主数据与资料数据使用 IndexedDB；`chrome.storage.local` 仅保存设置和轻量元数据。
- 不新增 host、tabs、history、clipboard 或 downloads 权限。
- 文件副本单个最大 20 MB；JSON 备份不包含 Blob，仅包含文件元数据和缺失副本提示。
- 所有核心流程支持离线、键盘操作和非颜色化状态表达。

---

### Task 1: 建立资料领域模型与数据库迁移

**Files:**
- Create: `src/domain/resource.js`
- Create: `src/data/resource-repository.js`
- Modify: `src/data/database.js`
- Test: `tests/domain/resource.test.js`
- Test: `tests/data/resource-repository.test.js`
- Test: `tests/data/database.test.js`

**Interfaces:**
- `normalizeResource(input, { generateId, now })` returns a validated resource with `id`, `type`, `title`, `note`, type-specific fields, `createdAt`, `updatedAt`, and `revision`.
- `validateResource(resource)` rejects unsupported types, invalid HTTP(S) URLs, empty titles, overlong notes/content, and file copies over 20 MiB.
- `ResourceRepository.create(resource)`, `get(id)`, `update(resource, expectedRevision)`, `list(filters)`, `delete(id)`, `attachTask(taskId, resourceId)`, `detachTask(taskId, resourceId)`, `listForTask(taskId)`, `listUnattached()`, and `listTaskIds(resourceId)` return structured clones.
- Database version becomes 4 and creates `resources` keyed by `id`, indexes `type`, `updatedAt`, and `storageMode`, plus `taskResources` keyed by `[taskId, resourceId]` with indexes on `taskId` and `resourceId`.

- [ ] **Step 1: Write failing domain tests**

  Cover URL validation, snippet length 20,000, note length 2,000, file metadata normalization, `storageMode` rules, 20 MiB copy limit, immutable `createdAt`, and revision increment.

- [ ] **Step 2: Run domain tests and verify they fail**

  Run: `node --test tests/domain/resource.test.js`
  Expected: FAIL because the resource module does not exist.

- [ ] **Step 3: Implement the resource domain module**

  Keep all type-specific normalization in `src/domain/resource.js`; reject `javascript:` and non-HTTP(S) URLs, preserve `Blob` only for `copy`, and clone all mutable inputs.

- [ ] **Step 4: Write repository and migration tests**

  Verify v3 databases upgrade to v4, existing tasks remain unchanged, resource/task-resource stores and indexes exist, attach is idempotent, detach does not delete the resource, and revision conflicts reject stale updates.

- [ ] **Step 5: Implement IndexedDB stores and repository**

  Use existing `requestResult`/transaction patterns. Store resources and associations in one transaction for attach/detach. Never load Blob values in task list queries.

- [ ] **Step 6: Run targeted tests**

  Run: `node --test tests/domain/resource.test.js tests/data/resource-repository.test.js tests/data/database.test.js`
  Expected: PASS.

- [ ] **Step 7: Commit**

  `git add src/domain/resource.js src/data/resource-repository.js src/data/database.js tests/domain/resource.test.js tests/data/resource-repository.test.js tests/data/database.test.js && git commit -m "feat: add resource data model and storage"`

### Task 2: Add resource service, searching, and backup contracts

**Files:**
- Create: `src/services/resource-service.js`
- Modify: `src/services/backup-service.js`
- Test: `tests/services/resource-service.test.js`
- Test: `tests/services/backup-service.test.js`

**Interfaces:**
- `ResourceService.createUrl({ title, url, note })`
- `ResourceService.createSnippet({ title, content, note })`
- `ResourceService.createFile({ title, file, note, saveCopy })`
- `ResourceService.update(id, input, expectedRevision)`
- `ResourceService.remove(id, expectedRevision)` rejects deletion when the resource is attached unless `{ force: true }` is explicitly provided by the UI confirmation.
- `ResourceService.search({ text, type })` matches title, note, URL, fileName, and snippet content, but never Blob bytes.
- Backup payload adds `resources`, `taskResources`, and `resourceCopyWarnings`; Blob fields are omitted and copy resources carry `copyIncluded: false`.

- [ ] **Step 1: Write failing service tests**

  Cover creation of all types, explicit `saveCopy`, 20 MiB rejection, search fields, unattached listing, attached-delete rejection, and backup import validation for orphan and duplicate associations.

- [ ] **Step 2: Run tests to verify failure**

  Run: `node --test tests/services/resource-service.test.js tests/services/backup-service.test.js`
  Expected: FAIL with missing service methods or missing backup resource fields.

- [ ] **Step 3: Implement service behavior**

  Keep file selection outside the service; pass a browser `File`/`Blob` into `createFile`. Use `structuredClone` for metadata and keep Blob only when `saveCopy` is true.

- [ ] **Step 4: Extend backup preview/merge/replace**

  Validate resources before touching the repository, preserve existing resources on merge, replace resources on replace, and return a warning count for omitted file copies.

- [ ] **Step 5: Run targeted tests**

  Run: `node --test tests/services/resource-service.test.js tests/services/backup-service.test.js`
  Expected: PASS.

- [ ] **Step 6: Commit**

  `git add src/services/resource-service.js src/services/backup-service.js tests/services/resource-service.test.js tests/services/backup-service.test.js && git commit -m "feat: add resource service and backup support"`

### Task 3: Wire resource services into Dashboard and task editor

**Files:**
- Modify: `src/dashboard/index.js`
- Modify: `src/dashboard/index.html`
- Modify: `src/dashboard/index.css`
- Modify: `src/dashboard/task-editor.js`
- Create: `src/dashboard/resource-picker.js`
- Test: `tests/e2e/resource-task-editor.spec.js`

**Interfaces:**
- `createResourcePicker({ root, resourceService, onChanged, onError })` exposes `openForTask(taskId)` and `openCreate({ taskId })`.
- Picker events call `resourceService.createUrl`, `createSnippet`, `createFile`, `attach`, and `detach`; after every successful mutation it calls `onChanged` and restores focus to the originating control.
- Task editor receives `resourceService` and renders `data-resource-count`, `data-resource-list`, `data-resource-add`, and `data-resource-link` controls.

- [ ] **Step 1: Write failing E2E tests**

  Cover creating a URL from an existing task, creating a snippet, selecting a local file without saving a copy, displaying the resource count, detaching without deleting, and reopening the picker with keyboard focus intact.

- [ ] **Step 2: Run the E2E test to verify failure**

  Run: `npx playwright test tests/e2e/resource-task-editor.spec.js`
  Expected: FAIL because the editor has no resource controls.

- [ ] **Step 3: Add the picker and editor section**

  Add a collapsed “相关资料” section after the core fields. The create form uses one type switcher and type-specific fields; file input uses explicit `saveCopy` checkbox and shows the 20 MiB constraint before submit.

- [ ] **Step 4: Wire Dashboard dependencies**

  Instantiate `ResourceRepository` and `ResourceService` once in `index.js`, pass them to task editor and views, and keep resource operations independent from task revision updates.

- [ ] **Step 5: Run targeted E2E tests**

  Run: `npx playwright test tests/e2e/resource-task-editor.spec.js`
  Expected: PASS.

- [ ] **Step 6: Commit**

  `git add src/dashboard/index.js src/dashboard/index.html src/dashboard/index.css src/dashboard/task-editor.js src/dashboard/resource-picker.js tests/e2e/resource-task-editor.spec.js && git commit -m "feat: attach resources from task editor"`

### Task 4: Add the resource inbox route

**Files:**
- Modify: `src/dashboard/index.html`
- Modify: `src/dashboard/index.js`
- Modify: `src/dashboard/index.css`
- Create: `src/dashboard/views/resources-view.js`
- Test: `tests/e2e/resources-inbox.spec.js`

**Interfaces:**
- `createResourcesView({ root, resourceService, taskQuery, onEditTask, onError })` renders resource list, filters, create form, association dialog, and delete confirmation.
- Route id is `resources`, route metadata is `资料收集箱`, and navigation places it under “任务” after “收集箱”.
- Unattached resources are visibly labeled “未关联任务”; attached resources show the number of tasks and allow selecting tasks to associate.

- [ ] **Step 1: Write failing E2E tests**

  Cover route navigation, creating an unattached URL and snippet, type filtering, keyword search, associating a resource to two tasks, detaching one task, and deleting an unattached resource.

- [ ] **Step 2: Run to verify failure**

  Run: `npx playwright test tests/e2e/resources-inbox.spec.js`
  Expected: FAIL because route and view do not exist.

- [ ] **Step 3: Implement the view**

  Follow existing view request-version and `runViewAction` patterns. Do not render Blob contents in the list. Use a details panel for full URL, snippet content, file metadata, and copy/download actions.

- [ ] **Step 4: Add route and navigation**

  Add the route to `routeMeta`, route map, navigation group, keyboard navigation labels, and visible route tests.

- [ ] **Step 5: Run targeted E2E tests**

  Run: `npx playwright test tests/e2e/resources-inbox.spec.js`
  Expected: PASS.

- [ ] **Step 6: Commit**

  `git add src/dashboard/index.html src/dashboard/index.js src/dashboard/index.css src/dashboard/views/resources-view.js tests/e2e/resources-inbox.spec.js && git commit -m "feat: add resource inbox"`

### Task 5: Add resource-aware search, export messaging, and recovery UX

**Files:**
- Modify: `src/dashboard/views/all-tasks-view.js`
- Modify: `src/dashboard/views/settings-view.js`
- Modify: `src/dashboard/task-list.js`
- Modify: `src/dashboard/views/history-view.js`
- Modify: `src/dashboard/index.css`
- Test: `tests/e2e/resource-search-backup.spec.js`

**Interfaces:**
- All-task filters add `hasResources` without changing existing task sort semantics.
- Task rows show text “资料 N” when `N > 0`; no color-only indication.
- Backup preview and result display omitted file-copy count and an actionable sentence to reselect missing files.
- Completed task detail/history can reveal resource count and links without auto-expanding long content.

- [ ] **Step 1: Write failing E2E tests**

  Cover searching a URL title from the resource inbox, filtering tasks with resources, visible resource count on a task row, and import preview warning for omitted file copies.

- [ ] **Step 2: Run to verify failure**

  Run: `npx playwright test tests/e2e/resource-search-backup.spec.js`
  Expected: FAIL because resource-aware filters and warning UI are absent.

- [ ] **Step 3: Implement search and list affordances**

  Keep resource search separate from task search, join only IDs for `hasResources`, and add accessible text labels to rows.

- [ ] **Step 4: Implement backup warning UI**

  Show warning before replace/merge confirmation and after completion. Do not claim that a file copy was backed up when it was not.

- [ ] **Step 5: Run targeted E2E tests**

  Run: `npx playwright test tests/e2e/resource-search-backup.spec.js`
  Expected: PASS.

- [ ] **Step 6: Commit**

  `git add src/dashboard/views/all-tasks-view.js src/dashboard/views/settings-view.js src/dashboard/task-list.js src/dashboard/views/history-view.js src/dashboard/index.css tests/e2e/resource-search-backup.spec.js && git commit -m "feat: surface resources in search and backup"`

### Task 6: Complete file-copy behavior and responsive/accessibility hardening

**Files:**
- Modify: `src/dashboard/resource-picker.js`
- Modify: `src/dashboard/views/resources-view.js`
- Modify: `src/dashboard/index.css`
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.css`
- Test: `tests/e2e/resource-file-copy.spec.js`
- Test: `tests/e2e/responsive.spec.js`

**Interfaces:**
- File copy opens through an explicit user action and never loads Blob data in list views.
- A missing reference exposes “重新选择文件”; selecting a replacement updates metadata only after the user confirms.
- Resource forms work at 390px without horizontal overflow and are keyboard navigable.

- [ ] **Step 1: Write failing file and responsive tests**

  Cover saving a small file copy, rejecting a synthetic file over 20 MiB, replacing a missing reference, downloading/opening a saved copy, keyboard escape, focus restoration, and 390px no-overflow.

- [ ] **Step 2: Run to verify failure**

  Run: `npx playwright test tests/e2e/resource-file-copy.spec.js tests/e2e/responsive.spec.js`
  Expected: file-copy cases fail while the existing responsive suite remains green.

- [ ] **Step 3: Implement explicit copy and replacement flows**

  Use object URLs only for the duration of an explicit action, revoke them afterward, and keep metadata and Blob mutations atomic.

- [ ] **Step 4: Harden mobile and keyboard presentation**

  Add visible labels, focus-visible outlines, non-color status text, and responsive wrapping for resource cards and dialogs.

- [ ] **Step 5: Run targeted tests**

  Run: `npx playwright test tests/e2e/resource-file-copy.spec.js tests/e2e/responsive.spec.js`
  Expected: PASS.

- [ ] **Step 6: Commit**

  `git add src/dashboard/resource-picker.js src/dashboard/views/resources-view.js src/dashboard/index.css src/popup/popup.html src/popup/popup.css tests/e2e/resource-file-copy.spec.js tests/e2e/responsive.spec.js && git commit -m "feat: support local resource copies accessibly"`

### Task 7: Full verification and delivery report

**Files:**
- Create: `docs/acceptance/v1.2-context-resources-verification-report.md`
- Test: all existing unit and E2E suites

**Interfaces:**
- Verification report records exact commands, counts, migration evidence, permission check, responsive evidence, and known limitations.
- The report must state that JSON backup excludes Blob bytes and that no host/clipboard/history permissions were added.

- [ ] **Step 1: Run the complete unit suite**

  Run: `npm run test:unit`
  Expected: all unit tests pass.

- [ ] **Step 2: Run the complete E2E suite**

  Run: `npm run test:e2e`
  Expected: all existing and new E2E tests pass.

- [ ] **Step 3: Run layout and permission checks**

  Run: `node .workbuddy/tmp/audit-ui.cjs` with the repository preview server and inspect the generated report; verify `manifest.json` still contains only `storage`.

- [ ] **Step 4: Write the verification report**

  Record test counts, database v3→v4 upgrade result, 390px overflow result, resource copy warning result, and any explicit limitations.

- [ ] **Step 5: Run final full test command**

  Run: `npm test`
  Expected: unit and E2E suites both pass with zero failures.

- [ ] **Step 6: Commit and push the completed branch**

  `git add docs/acceptance/v1.2-context-resources-verification-report.md && git commit -m "docs: verify v1.2 context resources"`

  Push the worktree branch only after the final verification report is complete; keep the original checkout untouched until the branch is reviewed.
