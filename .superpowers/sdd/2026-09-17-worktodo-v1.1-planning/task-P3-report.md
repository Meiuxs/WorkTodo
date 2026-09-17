# Task P3 report — 增加本周视图

## 结果

- BASE: `4f792d22c19863c29b0139baa2fb3a906af2e5a9`
- P3 实现 HEAD: `3b5529a`
- 提交: `3b5529a feat: add week planning view`
- 状态: 完成，通过定向 E2E、全量单元测试和全量 Chromium E2E。

## RED

- 初始测试使用模糊名称 `本周`，匹配到了刚创建的“本周计划事项”任务标题，失败点不是目标导航。
- 将导航定位收紧为 `{ name: '本周', exact: true }` 后复跑，测试在等待该按钮时超时，确认红灯来自“本周”导航不存在。

## 验证

- `npx playwright test tests/e2e/planning.spec.js -g "本周视图"`
  - PASS: `1/1`
- `npm test`
  - 单元测试 PASS: `114/114`
  - Chromium E2E PASS: `17/17`
- 静态范围检查：工作树仅包含 P3 授权的五个产品/测试文件；未新增权限、网络请求、依赖或页面直接 IndexedDB 访问。

## 修改文件

- `src/dashboard/views/week-view.js`
- `src/dashboard/index.html`
- `src/dashboard/index.js`
- `src/dashboard/index.css`
- `tests/e2e/planning.spec.js`

## 遗留

- 原 `DashboardController` 固定路由和 `index.js` 槽位别名限制已在下方审查修复循环中解决。
- 390px 无横向溢出和键盘打开任务属于 P6 验收范围，本任务未新增对应断言。

## 第一轮审查修复循环

- 审查发现：快速点击“本周”后立即点击“今天”，较慢的旧周视图 render 可能在最新导航完成后覆盖正文。
- 根因：`index.js` 使用可变 `activeRoute` 将 `tomorrow/week` 映射到控制器的 `today` 槽位；`DashboardController` 也没有并发渲染顺序保护。
- 红灯：新增控制器路由与竞态单测后，`tomorrow` 被回退为 `today`；旧同步读取与最新导航交错的渲染顺序为 `inbox, today`，旧视图最后写入。
- 修复：控制器正式识别 `tomorrow/week`；`index.js` 直接注册并导航到各视图，删除 `activeRoute` 别名。当时使用递增渲染版本和串行渲染队列跳过过期请求；第二轮复审确认该队列会等待永久 pending 的旧 render，因此已在下一节替换。
- 验证：`node --test tests/services/dashboard-controller.test.js` 为 `8/8`；定向本周 E2E 为 `1/1`；新增竞态 E2E 后完整 `planning.spec.js` 为 `2/2`；`npm test` 为单元 `116/116`、Chromium E2E `18/18`。

## 第二轮审查修复循环

- 复审发现：串行渲染队列会等待旧 render。若旧 render 永不结束，最新导航也永久无法执行。
- 红灯：新增取消语义单测后，旧 render pending 时最新导航在 100ms 内仍未完成；旧视图没有收到 AbortSignal；取消后的 `AbortError` 直接拒绝调用方。
- 修复：删除渲染队列和版本号。每次 `navigate/refresh` 创建新的 `AbortController` 并立即 abort 上一个；控制器通过 `Promise.race` 让被取消的旧调用及时返回，最新 render 不等待旧 Promise。所有视图接收 signal，在异步查询后、写 DOM 前检查 `signal.aborted`，内部筛选、历史和设置重渲染继续沿用当前 signal。
- 验证：`node --test tests/services/dashboard-controller.test.js` 为 `10/10`；完整 `planning.spec.js` 为 `3/3`，其中包含永久 pending 周查询不阻塞最新导航的 E2E；`npm test` 为单元 `118/118`、Chromium E2E `19/19`。

## 第三轮审查修复循环

- 复审发现 P1：初始 render 完成时清空 `#renderAbortController`，导致已加载视图事件监听器持有的 signal 永远不会被后续导航取消。history 延迟按周切换会覆盖今天，settings 延迟操作同样会越过新路由。
- 复审发现 P2：all-tasks 延迟搜索返回后访问新 root 的 `#filter-count`，产生空节点异常。
- 复审发现 P2：settings 将旧设置页 DOM 更新和用户副作用混在一起。导航后导出被跳过，导入及分类变更后也未调用 `onDataChanged()`。
- 红灯：控制器回归中初始 render 后的 signal 在下一次导航时仍为未取消；history 延迟按周切换在导航后重新覆盖正文，今天标题下找不到今天视图。
- 修复：AbortController 现在表示完整视图生命周期，从 `navigate/refresh` 开始保留到下一次 `navigate/refresh`，单次 render resolve 时不再清空；底层 render promise 增加兜底 catch，取消后迟到的普通 rejection 不会成为未处理异常。
- 修复：all-tasks 在 signal aborted、列表节点已脱离或计数节点不存在时直接返回，不再接触旧 DOM。
- 修复：导出即使在导航后也完成下载；导入和分类创建、改名、删除完成后始终调用 `onDataChanged()` 刷新当前路由，仅旧设置页自身重绘受 signal 阻止。
- 验证：`node --test tests/services/dashboard-controller.test.js` 为 `11/11`；完整 `planning.spec.js` 为 `7/7`，覆盖 history 延迟切换、延迟搜索和导航后导出；`npm test` 为单元 `119/119`、Chromium E2E `23/23`。
