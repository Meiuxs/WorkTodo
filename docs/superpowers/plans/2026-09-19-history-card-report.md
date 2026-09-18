# 工作记录卡片报表实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 将工作记录页从线性指标清单改为轻量卡片报表，在不改变统计口径和数据模型的前提下，让用户先看到结论，再查看核心指标、工作节奏和完成明细。

**Architecture:** 保留 StatisticsService、SummaryService 和任务查询接口，仅调整 history-view.js 的语义结构与 index.css 的视觉层级。页面采用“结论双卡 + 核心指标条 + 工作节奏卡 + 明细列表”的层级；完成率为 null 时显示“暂无计划”，不伪装成 0%。任务明细继续使用线性结构，避免所有内容卡片化。

**Tech Stack:** Manifest V3、原生 HTML/CSS/JavaScript、IndexedDB、浏览器内置 API、Node.js test runner、Playwright。

**Spec:** docs/prototypes/history-card-report/index.html；产品约束见 AGENTS.md 与 docs/superpowers/specs/2026-09-18-worktodo-ux-v1.1-design.md。

## 全局约束

- 目标平台：Chromium 110+、统信 UOS、ARM64。
- 产品运行时不依赖服务器、网络、Node.js、npm 或第三方 CDN。
- 任务主数据继续使用 IndexedDB，不改变现有统计数据模型和统计口径。
- 不声明与功能无关的权限，不读取网页内容、浏览历史、密码、Cookie 或剪贴板。
- 所有核心流程继续支持离线、键盘操作和非颜色化状态表达。
- 延续暖白、薄荷灰、深墨绿、青绿色与珊瑚色的清透网格视觉语言；不使用渐变、发光装饰或堆叠卡片。
- 修改运行时代码后先运行 npm test，再运行 npm run package。

---

### Task 1：固定工作记录页的报表语义结构

**Files:**
- Modify: src/dashboard/views/history-view.js:70-121
- Test: tests/services/summary-service.test.js:265-324

**Interfaces:**
- Consumes: statistics.daily() / statistics.weekly() 返回的 completedCount、plannedCount、createdCount、postponedCount、completionRate、plannedCompletedCount、carriedOverCompletedCount。
- Produces: 保持 data-history-mode、#history-date、data-summary-kind、#history-summary-text、#history-list 不变；保留并明确 .history-report-top、.report-metrics、.history-breakdown。

- [ ] **Step 1：补充视图契约断言**

在现有 History 视图单元测试中增加：

    assert.match(root.innerHTML, /class="history-report-top"/);
    assert.match(root.innerHTML, /class="history-insight"/);
    assert.match(root.innerHTML, /class="history-rate"/);
    assert.match(root.innerHTML, /class="metrics report-metrics"/);
    assert.match(root.innerHTML, /class="history-breakdown"/);

- [ ] **Step 2：运行单个测试确认断言状态**

运行：

    npm run test:unit -- tests/services/summary-service.test.js

预期：新增断言能验证当前 DOM 结构；若已有结构通过，则继续完成语义状态改造。

- [ ] **Step 3：保持报表阅读顺序**

在 history-view.js 中固定顺序：

    history-report-top  // 结论卡 + 完成率卡
    report-metrics      // 核心指标
    history-breakdown   // 工作节奏
    summary-panel       // 按需生成总结
    history-list        // 实际完成明细

保留“新增任务”和“历史延期完成”等完整指标，避免改变已有统计测试和复制总结的数据来源。

- [ ] **Step 4：修正无计划状态的可访问文本**

在计算完成率展示文本的位置加入：

    const completionLabel = summary.completionRate === null
      ? '完成率暂无计划'
      : '完成率 ' + completionPercent + '%';

将完成率容器的 aria-label 改为使用 completionLabel。无计划时进度条宽度保持 0%，但文案显示 “— / 暂无计划”，不能把无计划误报为 0%。

- [ ] **Step 5：再次运行单元测试**

运行：

    npm run test:unit -- tests/services/summary-service.test.js

预期：原有日/周指标、总结生成和异步保护测试全部通过。

### Task 2：将桌面端工作记录恢复为轻量卡片报表

**Files:**
- Modify: src/dashboard/index.css:720-737,769-790,1123-1133
- Test: tests/e2e/planning.spec.js:323-338

**Interfaces:**
- Consumes: Task 1 的报表结构和现有 CSS 令牌。
- Produces: 桌面端结论双卡、核心指标条、工作节奏卡；任务明细仍为线性列表。

- [ ] **Step 1：增加端到端结构检查**

在工作记录相关 Playwright 测试中进入工作记录后验证：

    await expect(page.locator('.history-report-top')).toBeVisible();
    await expect(page.locator('.history-insight')).toBeVisible();
    await expect(page.locator('.history-rate')).toBeVisible();
    await expect(page.locator('.report-metrics')).toBeVisible();
    await expect(page.locator('.history-breakdown')).toBeVisible();

- [ ] **Step 2：运行工作记录测试**

运行：

    npx playwright test tests/e2e/planning.spec.js --grep "工作记录"

预期：当前功能测试通过；视觉层级由下一步 CSS 改造完成。

- [ ] **Step 3：覆盖线性布局中的降级规则**

在 index.css 的“线性工作台重构”段落中，移除对工作记录卡片的线性覆盖，尤其是：

    .history-insight, .history-rate { border: 0; background: transparent; padding: 0; }
    .history-breakdown { border-right: 0; border-left: 0; background: transparent; }

恢复为暖白表面、1px 边界、统一圆角和统一内间距，使用已有 --surface-raised、--line、--r-md、--sp-5 令牌。

- [ ] **Step 4：限制卡片层级**

保留现有指标网格的 1px 分隔线写法，并增加：

    .report-metrics { margin-top: var(--sp-5); }
    .report-metrics dd { font-variant-numeric: tabular-nums; }

不要为每个指标增加独立阴影或大圆角，避免形成卡片堆。

- [ ] **Step 5：保持窄屏布局**

在 max-width: 680px 下让结论卡上下排列，指标使用 auto-fit 换行；工作节奏标题允许换行；确认按钮、输入框和进度条不造成横向溢出。

- [ ] **Step 6：运行端到端测试**

运行：

    npx playwright test tests/e2e/planning.spec.js --grep "工作记录"

预期：总结生成、复制、异步切换、390px 无横向溢出测试全部通过。

### Task 3：优化空状态和完成率展示

**Files:**
- Modify: src/dashboard/views/history-view.js:70-107
- Modify: src/dashboard/index.css:714-737
- Test: tests/services/summary-service.test.js:265-324
- Test: tests/e2e/planning.spec.js:323-338

**Interfaces:**
- Consumes: Task 1 的 completionLabel 和统计结果。
- Produces: “暂无计划”与“完成率 0%”分离的语义状态；空完成记录保留清晰下一步提示。

- [ ] **Step 1：增加无计划场景断言**

使用 completionRate: null 的统计结果渲染工作记录，并断言：

    assert.match(root.innerHTML, /完成率暂无计划/);
    assert.match(root.innerHTML, /<div class="history-rate__value">—<\/div>/);

- [ ] **Step 2：调整空状态文案**

保持明细列表的 emptyMessage 为“这个区间还没有实际完成记录。”，将结论区从“先完成一件小事”调整为“还没有完成记录”，并在短句中说明可以完成一项后回来查看。

- [ ] **Step 3：确保总结编辑器按需出现**

总结文本框继续使用 hidden，未生成总结时只显示轻量提示，不为 180px 文本编辑区预留空间。

- [ ] **Step 4：运行单元和窄屏测试**

运行：

    npm run test:unit -- tests/services/summary-service.test.js
    npx playwright test tests/e2e/planning.spec.js --grep "总结面板在 390px"

预期：全部通过，且无横向滚动。

### Task 4：完整验证并更新交付记录

**Files:**
- Modify: docs/acceptance/v1.2-ux-deep-review.md
- Verify: src/dashboard/views/history-view.js
- Verify: src/dashboard/index.css
- Verify: docs/prototypes/history-card-report/index.html

**Interfaces:**
- Consumes: Task 1-3 的页面结构、样式和测试结果。
- Produces: 可回溯的 UX 交付记录和可导入 Chromium 的发布包。

- [ ] **Step 1：运行完整测试**

运行：

    npm test

预期：单元测试和端到端测试全部通过。

- [ ] **Step 2：检查关键视口和键盘流程**

验证 1440px 与 390px：

- 1440px：结论双卡并排，指标条清晰，工作节奏卡和明细列表顺序稳定。
- 390px：结论卡上下排列，指标自动换行，scrollWidth <= clientWidth + 1。
- 键盘：按日/按周按钮可聚焦，焦点环可见，生成总结后焦点不丢失。

- [ ] **Step 3：更新 UX 审查记录**

在 docs/acceptance/v1.2-ux-deep-review.md 记录：工作记录采用轻卡片报表；结论卡优先；完整统计保留但不全部独立卡片化；无计划状态不再伪装为 0%。

- [ ] **Step 4：生成扩展压缩包**

运行：

    npm run package

预期：生成 dist/WorkTodo-v0.1.0.zip，压缩包只包含 manifest.json 和 src/。

- [ ] **Step 5：检查当前任务范围**

运行：

    git status --short

确认只包含当前工作记录页面、测试、审查记录和本计划相关文件；不提交 dist/ 或独立原型之外的临时文件。
