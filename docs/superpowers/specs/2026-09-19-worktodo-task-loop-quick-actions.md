# WorkTodo 任务闭环与快捷操作体验优化规格

## Problem Statement

WorkTodo 已经覆盖任务创建、计划、完成、取消、回收站、资料上下文、导入导出和工作记录，但几个高频流程的用户语义仍不一致：快速新增后的“撤销”会被误解为删除，Popup 的逾期总数可能与可见列表不一致，导入合并缺少风险确认，资料和导入弹窗的焦点行为不完整。任务行也缺少日期与优先级的低摩擦快捷操作，收集箱容易退化为长期堆积区。

这些问题会削弱用户对任务闭环的信任。用户需要明确知道任务当前在哪里、发生了什么、下一步能做什么，以及误操作后如何恢复。

## Solution

把 WorkTodo 的主体验明确为“记录 → 整理 → 推进 → 完成/取消 → 恢复或回顾”的完整任务闭环，并统一所有入口的语义和恢复路径。

快速新增提供真正的撤销创建；主动删除才进入回收站；完成、取消和回收站删除分别拥有清晰的恢复方式。Popup 只展示少量重点任务，但逾期数量必须与展示策略一致。导入合并与覆盖都必须经过明确风险确认。任务行增加日期和优先级快捷菜单，桌面、键盘和窄屏触控使用同一套操作能力。

收集箱被定义为待整理队列；用户界面将“分类”称为“列表”，标签继续作为跨列表属性；资料保持任务的可选上下文。提醒/通知和独立截止日期不纳入本规格。

## User Stories

1. As a knowledge worker, I want to record a task with only a title and one Enter, so that capturing an interruption takes a few seconds.
2. As a user who created a task by mistake, I want to undo creation immediately, so that the accidental task does not pollute my回收站。
3. As a user deleting an existing task, I want it to move to the回收站, so that I can restore it later if needed.
4. As a user restoring a task, I want its previous active task information to remain intact, so that recovery does not require re-entering details.
5. As a user completing a task, I want a short-lived undo action, so that an accidental completion can be reversed without searching another page.
6. As a user cancelling a task, I want to restore it to待办, so that cancellation remains reversible.
7. As a user viewing the Popup, I want the overdue count to match the visible overdue items or clearly indicate that more items exist, so that I do not underestimate overdue work.
8. As a user with more than three focus tasks, I want an obvious link to the full workbench, so that I can continue processing the hidden items.
9. As a user importing a backup in merge mode, I want to see the impact and confirm it explicitly, so that local data is not changed unexpectedly.
10. As a user importing a backup, I want replace mode to explain recovery and omitted file copies, so that I understand what can and cannot be restored.
11. As a keyboard user, I want a dialog to focus its first valid field when it opens, so that I can complete the flow without hunting for focus.
12. As a keyboard user, I want focus to return to the triggering control when a dialog closes, so that navigation remains predictable.
13. As a user associating a resource with a task, I want the association dialog to show an explicit empty state when no eligible task exists, so that I know why association is unavailable.
14. As a user viewing resources, I want to see the number of tasks associated with each resource, so that I can identify unused or highly reused context.
15. As a user managing a task, I want quick date options for today, tomorrow, the day after tomorrow, next Monday, next week, a custom date, and removing the planned date, so that routine planning takes one short interaction.
16. As a user managing a task, I want to set priority to none, low, medium, or high from the task row, so that prioritization does not require opening the full editor.
17. As a user with low vision or color blindness, I want priority and task status expressed with text and structure as well as color, so that meaning is not lost.
18. As a keyboard user, I want `D` to open date actions and `P` to open priority actions when a task is focused, so that frequent planning actions remain fast without conflicting with global navigation shortcuts.
19. As a mobile or narrow-screen user, I want the same date and priority actions in the task’s more menu, so that no important action depends on hover.
20. As a user processing the收集箱, I want each task to have an obvious next action—schedule, enrich, keep, complete, cancel, or delete—so that the queue does not become a permanent second all-tasks list.
21. As a user organizing tasks, I want “列表” to represent primary task ownership and “标签” to represent cross-list attributes, so that the two organization concepts are easy to distinguish.
22. As a user browsing tasks, I want secondary actions such as subtasks, date, priority, move, tags, star, copy, and delete grouped under one more menu, so that the task row stays scannable.
23. As a user reviewing work, I want to see what was completed, what was delayed, what remains in the收集箱, and what deserves attention next, so that工作记录 leads to action rather than only reporting numbers.
24. As a user with a large task history, I want long lists to remain scrollable, searchable, and keyboard-operable, so that the product stays usable beyond a few hundred tasks.
25. As a user working offline, I want all core task, recovery, planning, and review actions to work locally, so that the workflow does not depend on a network connection.

## Implementation Decisions

- Preserve the existing domain lifecycle and make the user-facing distinction explicit between撤销创建、完成/取消恢复、回收站恢复和永久删除。
- Add a dedicated quick-create undo path rather than routing undo through the generic trash action.
- Keep the Popup as a focused capture surface; show only a small number of tasks and provide a clear route to the workbench for overflow.
- Make overdue counts and visible task subsets use one explicit presentation contract.
- Require a product confirmation dialog for both merge and replace import modes; describe conflicts, counts, recovery points, and omitted file copies in user language.
- Centralize dialog focus entry and focus restoration for task, resource, import, confirmation, and association flows.
- Add one shared task-row quick-action model for date and priority menus so that pointer, keyboard, and narrow-screen interactions remain equivalent.
- Use date presets today, tomorrow, day after tomorrow, next Monday, next week, custom date, and remove planned date; keep the native date picker for custom input.
- Use four priority values: none, low, medium, and high. Express each value with text plus semantic visual treatment.
- Treat the收集箱 as a location/queue, not a lifecycle state. Treat列表 as primary ownership and标签 as cross-cutting metadata.
- Keep资料上下文 optional and task-owned. Display relation counts and an explicit empty state when no eligible task can be associated.
- Keep the current single主计划日期 model and optional time range; do not add an independent deadline in this scope.
- Keep reminders/notifications out of scope so the extension does not gain new permissions or unreliable time-trigger behavior.
- Retain the existing navigation capabilities but present them with a smaller conceptual set: 今天、即将到来、日历、收集箱、全部任务、已完成、回收站、工作记录、资料收集箱和设置。
- Prefer the existing Dashboard/Popup/settings seams and existing services for behavior changes; avoid introducing a new state-management layer.

## Testing Decisions

- Test user-visible behavior at the highest existing seam: Playwright end-to-end flows across Popup, Dashboard task rows, settings import, and resource dialogs.
- Add regression coverage for Popup overdue overflow, Popup undo, Dashboard quick-create undo, merge-import cancel/confirm, dialog focus entry/restoration, association empty state, and date/priority quick actions.
- Reuse domain/service unit-test seams for quick date options, priority transitions, undo-created-task semantics, and recovery invariants.
- Prefer assertions about visible labels, available actions, focus location, task lifecycle, and persisted outcomes; do not assert incidental DOM structure or implementation-specific helper calls.
- Add a browser-level large-list scenario that verifies scrolling, search, keyboard interaction, and acceptable render behavior with at least 1,000 tasks.
- Preserve existing responsive, dark-theme, reduced-motion, and accessibility coverage at the 390px viewport.

## Out of Scope

- Browser notifications, reminders, alarms, or new notification permissions.
- Separate deadline data in addition to the主计划日期.
- Natural-language date parsing.
- Converting tasks into notes or introducing a separate note object type.
- Cloud synchronization, collaboration, multi-user assignment, or server-side storage.
- Replacing IndexedDB or changing the offline-first storage model.
- A visual redesign that departs from the existing清透网格 design system.

## Further Notes

- The attached TickTick screenshot is treated as interaction inspiration for compact date/priority controls and a secondary task menu, not as a requirement to copy visual details.
- The current baseline passes 201 unit tests and 56 end-to-end tests. This specification adds behavior gaps that should be covered before claiming the experience is complete.
- The domain vocabulary for this specification is recorded in the repository glossary and the task-closure boundary is recorded in ADR-0001.
