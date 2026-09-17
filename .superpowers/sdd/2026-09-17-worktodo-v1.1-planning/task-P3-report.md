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

## 审查修复循环

- 审查发现：快速点击“本周”后立即点击“今天”，较慢的旧周视图 render 可能在最新导航完成后覆盖正文。
- 根因：`index.js` 使用可变 `activeRoute` 将 `tomorrow/week` 映射到控制器的 `today` 槽位；`DashboardController` 也没有并发渲染顺序保护。
- 红灯：新增控制器路由与竞态单测后，`tomorrow` 被回退为 `today`；旧同步读取与最新导航交错的渲染顺序为 `inbox, today`，旧视图最后写入。
- 修复：控制器正式识别 `tomorrow/week`；`index.js` 直接注册并导航到各视图，删除 `activeRoute` 别名。控制器通过递增渲染版本和串行渲染队列跳过过期请求；旧 render 已启动时，最新导航会在其结束后渲染并最终覆盖页面。
- 验证：`node --test tests/services/dashboard-controller.test.js` 为 `8/8`；定向本周 E2E 为 `1/1`；新增竞态 E2E 后完整 `planning.spec.js` 为 `2/2`；`npm test` 为单元 `116/116`、Chromium E2E `18/18`。
