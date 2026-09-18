# WorkTodo 1.3.0 UX 评审入口

## 评审目标

本次重构把 WorkTodo 从“任务列表管理器”调整为“今日推进工作台”，重点验证用户是否能快速完成这条路径：

> 临时记录 → 看清今天 → 推进下一步 → 完成或延期 → 回顾结果

评审重点不是功能数量，而是信息层级、动作优先级、视觉噪点和移动端可用性。

完整前端评审入口：[docs/review/index.html](review/index.html)

该页面是无依赖的静态预览，集中呈现今日工作台、快速记录、任务详情、计划、工作记录和 Popup，并支持桌面/390px 两种视图切换。

## 推荐评审顺序

### 1. 今日工作台

入口文件：[src/dashboard/index.html](../src/dashboard/index.html)

重点查看：

- 首屏是否第一时间找到“快速记录”。
- “今日进度 / 完成率 / 下一步”是否自然形成阅读顺序。
- 逾期任务是否足够醒目，但没有制造紧张感。
- 空状态是否给出了明确的下一步动作。
- 主界面是否采用清晰的纵向流和 Flex 排列，而不是规则网格或堆叠卡片。

### 2. 快速记录区

相关文件：[src/dashboard/index.html](../src/dashboard/index.html)

验证：

- 只填写标题即可保存。
- 计划日期仍然是可选的次级动作。
- “补充详情”不会打断快速记录路径。
- 保存后仍有撤销反馈。

### 3. Popup

入口文件：[src/popup/popup.html](../src/popup/popup.html)

重点查看：

- 是否先让用户记录，再展示少量今日重点。
- 输入框是否是最明显的主入口。
- Popup 是否避免复制 Dashboard 的全部功能。
- 360–390px 宽度下是否保持清晰。

### 4. 任务编辑抽屉

入口文件：[src/dashboard/index.html](../src/dashboard/index.html)

重点查看：

- “先确定 / 组织任务 / 需要时再补充”的层级是否降低认知负担。
- 标题、计划日期、优先级是否比高级字段更突出。
- 标签、重复规则、子任务和资料能力是否仍然可达。
- 校验失败时是否保持抽屉打开并保留输入。

### 5. 工作记录

相关文件：[src/dashboard/views/history-view.js](../src/dashboard/views/history-view.js)

重点查看：

- 是否先看到结论，再看到完成率和工作节奏。
- 未生成总结时是否不再出现大块空白编辑区。
- 指标是否辅助理解，而不是成为页面主角。

## 视觉与交互方向

- 暖白、薄荷灰、深墨绿、青绿色行动色、珊瑚色提醒色。
- 以留白、细分隔线和清楚的文字层级建立秩序。
- 主工作台采用线性阅读和 Flex 排列，避免规则网格和装饰性卡片。
- 月历保留必要的七列语义结构，不把日历强行改成线性列表。
- 状态不只依赖颜色，同时使用文字、数量、结构和键盘可达性表达。
- 保留离线、IndexedDB、键盘操作和现有路由兼容性。

## 建议评审问题

请评审人重点回答：

1. 第一次打开今日页，是否能在 3 秒内找到记录入口？
2. 是否能一眼判断今天最应该推进什么？
3. 逾期提示是否清楚但不过度打扰？
4. Popup 与 Dashboard 的职责是否足够区分？
5. 编辑抽屉是否仍然感觉字段太多？
6. 在 390px 宽度下，是否有横向溢出、按钮拥挤或导航难以理解？
7. 哪一处仍然显得像“功能堆叠”或产生了不必要的视觉噪点？

## 变更范围

- [src/dashboard/index.css](../src/dashboard/index.css)：主工作台布局、导航、摘要、任务区和响应式视觉。
- [src/dashboard/index.html](../src/dashboard/index.html)：导航分组、快速记录区和编辑抽屉层级。
- [src/dashboard/views/today-view.js](../src/dashboard/views/today-view.js)：今日推进摘要结构。
- [src/popup/popup.css](../src/popup/popup.css)：Popup 记录优先的视觉层级。
- [src/popup/popup.html](../src/popup/popup.html)：Popup 文案和结构。
- [tests/e2e/ux-refactor.spec.js](../tests/e2e/ux-refactor.spec.js)：新增 UX 回归测试。
- [manifest.json](../manifest.json)：版本号升级到 `1.3.0`。

## 验证结果

- 单元测试：195/195 通过。
- 端到端测试：53/53 通过。
- 390px 响应式检查通过。
- 月历键盘交互与七列结构检查通过。
- 扩展打包成功：`dist/WorkTodo-v1.3.0.zip`。

## Git 版本信息

- 上一版本 tag：`v1.2.0`
- 上一版本提交：`c336842`
- 当前版本提交：`9cc4d55`
- 当前分支：`main`
