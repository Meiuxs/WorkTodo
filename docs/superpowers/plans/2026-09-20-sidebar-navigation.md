# Sidebar Navigation & Settings Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Dashboard 侧栏的设置入口进入 `工作台导航` 地标、不再吸底、用分隔线与弱化色表达次级层级，并清掉窄屏媒体查询里真正重复的声明。

**Architecture:** 只动导航外壳。把 `.nav__footer` 从 `<nav>` 的兄弟移进 `<nav>` 内部并删除 `margin-top: auto`，用一条 `--line` 分隔线替代「系统」分组标签承担层级差；颜色（`--muted` / `--ink` / `--teal`）承担弱化，高度与字号不动。设置条目并入 `.nav button` 一组选择器，删除 `.nav__settings` 双轨声明。全程不新增路由、不新增 JS、不引入图标或 SVG。

**Tech Stack:** Manifest V3 浏览器扩展，原生 HTML/CSS/JavaScript，无构建步骤。测试用 `node --test`（单元）与 Playwright（E2E，拉起已加载扩展的 Chromium/Edge）。

**Spec:** `docs/superpowers/specs/2026-09-20-sidebar-navigation-design.md`

## Global Constraints

- 目标平台 Chromium 110+、统信 UOS、ARM64；Manifest V3、原生 HTML/CSS/JS。
- 运行时不依赖服务器、网络、Node.js、npm 或第三方 CDN；不得引入图标字体、远程字体或任何外部资源。
- 不新增权限，不读取网页内容、浏览历史、密码、Cookie 或剪贴板。
- 样式只引用 `src/styles/tokens.css` 的变量，业务样式表不出现裸数值（`tokens.css:1-2` 的约定）。
- 不通过缩小字号解决空间问题（`docs/superpowers/designs/2026-09-17-worktodo-ui-design.md` §6.1）；侧栏条目 `min-height` 保持 `44px`。
- 颜色、图标和动效都不是唯一的信息来源（同规范 §9）。
- Git commit message 用中文，格式 `类型：变更内容`（`AGENTS.md`）。
- `manifest.json` 的 `version` 是扩展发布版本唯一来源；本次为 PATCH，目标 `1.7.1`。
- 测试命令：单元 `npm run test:unit`；E2E `npx playwright test`。
- **E2E 前置**：仓库根的 `test-results/` 已累积超过 1600 个文件，Playwright 启动时会清理该目录，会被沙箱的单轮批量删除保护拦下并直接报错退出。本计划所有 E2E 步骤统一使用临时输出目录绕开它：
  `npx playwright test --output="$env:TEMP\worktodo-pw-out"`
  不要为此删除 `test-results/`，也不要修改 `playwright.config.js`。
- 本次不 tag、不创建 GitHub Release（用户已明确）；`docs/releases.md` 不新增条目。

## Review Focus

以下五类是 spec 隐含、但单看任务描述容易漏掉的失效场景，已分别绑定到拥有该代码的任务的测试里：

1. **矮窗口下设置入口不可达**：设置跟随导航末尾后，`.nav` 是唯一的滚动容器；若它的滚动能力被窄屏规则误改，矮窗口下设置可能永远点不到（Task 2）。
2. **390px 下导航被裁剪或出现横向滚动**：删除 A 段 `overflow: visible` 后 `.nav` 回到 base 的 `overflow-y: auto`，需要证明窄屏 wrap 布局没有被裁掉（Task 5）。
3. **窄屏下 11 个条目必须全部可见**：`.nav__footer` 成为 `.nav` 的子项后参与 wrap，若参与方式不对会挤掉分组条目（Task 5）。
4. **深色主题下 1px 分隔线不可见**：`--line` 在深色下是 `#31504b`，与 `--canvas` 背景靠得很近，需要证明它真的画得出来（Task 3）。
5. **选中态的颜色优先级被弱化规则盖掉**：`.nav__footer button { color: var(--muted) }` 与选中态规则特异性接近，规则顺序写错会让"设置"选中时仍是灰色（Task 3）。

---

### Task 1: 回写权威设计规范

`AGENTS.md` 要求"若实现与规范冲突，先更新规范和 README 的说明，再修改组件"，所以文档先行。

**Files:**
- Modify: `docs/superpowers/designs/2026-09-17-worktodo-ui-design.md`（头部第 4 行 `> 更新：`；在 §4.10 之后、`## 5. 状态与 UX 文案` 之前插入新节）
- 不动：`README.md`（已核对：全文没有侧栏、设置或导航相关描述，无需同步）
- 不动：`docs/superpowers/specs/2026-09-18-worktodo-ux-v1.1-design.md`（历史版本规格，作为该版本记录保留；其"五组"表述由权威规范取代，取代关系已记录在本次 spec 第 5 节）

**Interfaces:**
- Consumes: 无
- Produces: 规范中新增的「4.11 侧栏导航与设置入口」一节，作为侧栏分组结构的唯一定义来源；后续任务不得偏离该节描述

- [ ] **Step 1: 确认插入位置**

Run: `Select-String -Path docs/superpowers/designs/2026-09-17-worktodo-ui-design.md -Pattern "^### 4\.10|^## 5\." | ForEach-Object { "$($_.LineNumber): $($_.Line)" }`

Expected: 输出 `### 4.10 子任务的内联显示与父完成级联` 与 `## 5. 状态与 UX 文案` 两行，且 4.10 的行号小于 5 的行号。新节插在这两者之间。

- [ ] **Step 2: 插入规范章节**

在第 4.10 节内容结束处与 `## 5. 状态与 UX 文案` 之间插入：

```markdown
### 4.11 侧栏导航与设置入口

Dashboard 侧栏的导航结构固定为：无标签的「今天」主入口，加三组带标签的分组（计划、任务、回顾），最后是设置入口。

- 「今天」是唯一没有分组标签的条目，与品牌区之间额外空出一档间距；它是工作台的常驻主入口，不与「计划」组混排。
- 「计划」组含明天、本周、月历；「任务」组含收集箱、资料收集箱、全部任务、已完成、回收站；「回顾」组含工作记录。
- 设置入口不单独成组，也不吸底。它紧跟在「回顾」组之后：分隔线距上一条一个分组间距 `--sp-6`，按钮距分隔线 `--sp-4`。
- 层级差由结构和颜色承担，不由尺寸承担：分隔线用 `--line`，设置条目默认文字色 `--muted`，`:hover` 回到 `--ink`，当前页回到 `--teal`。它的 `min-height`（44px）与字号（`--fs-nav-item`）和普通条目完全一致。
- 设置入口位于 `<nav aria-label="工作台导航">` 地标内，读屏"跳转到导航"可以直达；它不得作为该地标的兄弟节点存在。
- 侧栏条目一律不使用图标。11 个条目里有四对近义项（明天/本周、收集箱/资料收集箱、全部任务/已完成、工作记录），图标无法唯一区分；且本产品不引入 SVG 资源与图标字体。将来若要引入整套图标语言，须作为独立决策，定义图标集、尺寸、线宽、深色主题处理和 `aria-hidden` 规则后再实施。
- 导航条目只有一套样式来源：`.nav button`。底部区不作为并列组件另写一份声明，它的差异只由 `.nav__footer` 这个结构表达。
```

- [ ] **Step 3: 更新文档头部的更新日期**

把文件第 4 行的 `> 更新：2026-09-19` 改为 `> 更新：2026-09-20`。

- [ ] **Step 4: 校验写入结果**

Run: `Select-String -Path docs/superpowers/designs/2026-09-17-worktodo-ui-design.md -Pattern "4\.11 侧栏导航与设置入口|更新：2026-09-20|不使用图标" | ForEach-Object { "$($_.LineNumber): $($_.Line)" }`

Expected: 三处都能命中，其中 `4.11 侧栏导航与设置入口` 的行号小于 `## 5.` 所在行。

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/designs/2026-09-17-worktodo-ui-design.md
git commit -m "文档：补充侧栏导航与设置入口设计规范"
```

---

### Task 2: 设置入口进入导航地标并取消吸底

**Files:**
- Modify: `src/dashboard/index.html:44-47`（把 `.nav__footer` 移入 `<nav>`）
- Modify: `src/dashboard/index.css:52`（删除 `.nav__footer` 的 `margin-top: auto`）
- Create: `tests/e2e/sidebar-navigation.spec.js`

**Interfaces:**
- Consumes: Task 1 的规范第 4.11 节
- Produces: `.nav__footer` 成为 `.nav` 的子元素（后续任务的 CSS 依赖这一点）；新测试文件 `tests/e2e/sidebar-navigation.spec.js`，后续任务在其中追加用例

- [ ] **Step 1: 写失败测试**

新建 `tests/e2e/sidebar-navigation.spec.js`：

```js
import { test, expect, openDashboard } from './fixtures.js';

test('设置入口位于工作台导航地标内且紧邻最后一个导航项', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  // 窗口要够高，否则侧栏本来就要滚动，量不出"设置被推到底部"这件事。
  await dashboard.setViewportSize({ width: 1280, height: 1000 });

  const nav = dashboard.getByRole('navigation', { name: '工作台导航' });
  const settings = nav.getByRole('button', { name: '设置', exact: true });
  await expect(settings).toBeVisible();

  const gap = await dashboard.evaluate(() => {
    const last = document.querySelector('[data-route="history"]').getBoundingClientRect();
    const entry = document.querySelector('[data-route="settings"]').getBoundingClientRect();
    return entry.top - last.bottom;
  });
  expect(gap).toBeGreaterThan(0);
  expect(gap).toBeLessThan(80);
});

test('矮窗口下导航自身可滚动且设置入口仍能到达并可聚焦', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 1280, height: 560 });

  const nav = dashboard.getByRole('navigation', { name: '工作台导航' });
  const settings = nav.getByRole('button', { name: '设置', exact: true });

  const overflowY = await dashboard.evaluate(() => getComputedStyle(document.querySelector('.nav')).overflowY);
  expect(overflowY).toBe('auto');

  await settings.scrollIntoViewIfNeeded();
  await expect(settings).toBeVisible();
  await settings.focus();
  await expect(settings).toBeFocused();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx playwright test tests/e2e/sidebar-navigation.spec.js --output="$env:TEMP\worktodo-pw-out"`

Expected: 两个用例都失败。第一个在 `expect(settings).toBeVisible()` 处失败，因为设置按钮此时是 `<nav>` 的兄弟，不在地标内，locator 解析不到元素。

- [ ] **Step 3: 把底部区移进导航地标**

`src/dashboard/index.html` 中，删除 `<nav>` 元素**之后**的整段底部区：

```html
        <div class="nav__footer">
          <p class="nav__label">系统</p>
          <button class="nav__settings" type="button" data-route="settings">设置</button>
        </div>
```

并把它插到 `<nav>` 内部、「回顾」分组之后、`</nav>` 之前，结果为：

```html
          <div class="nav__group">
            <p class="nav__label">回顾</p>
            <button type="button" data-route="history">工作记录</button>
          </div>
          <div class="nav__footer">
            <p class="nav__label">系统</p>
            <button class="nav__settings" type="button" data-route="settings">设置</button>
          </div>
        </nav>
```

此时还没有删除「系统」标签和 `nav__settings` 类——它们分别在 Task 3、Task 4 处理，本任务只搬位置。

- [ ] **Step 4: 删除吸底声明**

`src/dashboard/index.css` 第 52 行，把：

```css
.nav__footer { margin-top: auto; }
```

改为：

```css
/* 设置入口跟随导航末尾，不吸底：它紧跟在最后一个分组之后，
   靠 .nav__footer 的上边框与上方分隔（见「侧栏导航与设置入口」规范）。 */
.nav__footer { margin-top: 0; }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx playwright test tests/e2e/sidebar-navigation.spec.js --output="$env:TEMP\worktodo-pw-out"`

Expected: 2 passed。

- [ ] **Step 6: 确认既有测试未受影响**

Run: `npx playwright test tests/e2e/ux-refactor.spec.js --output="$env:TEMP\worktodo-pw-out"`

Expected: 全部通过。该文件里「快捷键完整清单集中在设置页，入口不再就地展示徽标」这一条会用 `getByRole('button', { name: '设置' })` 点击设置进入设置页，地标变化不应影响它。

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/index.html src/dashboard/index.css tests/e2e/sidebar-navigation.spec.js
git commit -m "优化：把设置入口移入工作台导航地标并取消吸底"
```

---

### Task 3: 用分隔线与弱化色表达设置的次级层级

**Files:**
- Modify: `src/dashboard/index.html`（删除 `<p class="nav__label">系统</p>`）
- Modify: `src/dashboard/index.css`（在 `.nav__settings` 声明块之后新增 `.nav__footer` 规则组）
- Test: `tests/e2e/sidebar-navigation.spec.js`（追加用例）

**Interfaces:**
- Consumes: Task 2 已把 `.nav__footer` 放入 `.nav` 内部
- Produces: `.nav__footer` 上的 `border-top` 与 `.nav__footer button` 的颜色规则；Task 4 依赖它们保持最终视觉效果不变
- 不产出：`data-variant` 或任何新属性——层级由 `.nav__footer` 结构表达

- [ ] **Step 1: 写失败测试**

在 `tests/e2e/sidebar-navigation.spec.js` 末尾追加：

```js
test('设置入口用分隔线和弱化色表达次级，且不占用分组标签', async ({ extension }) => {
  const dashboard = await openDashboard(extension);

  await expect(dashboard.locator('.nav__footer .nav__label')).toHaveCount(0);

  const style = await dashboard.evaluate(() => {
    const footer = getComputedStyle(document.querySelector('.nav__footer'));
    const button = getComputedStyle(document.querySelector('[data-route="settings"]'));
    return {
      borderTopWidth: footer.borderTopWidth,
      borderTopStyle: footer.borderTopStyle,
      borderTopColor: footer.borderTopColor,
      color: button.color,
      minHeight: button.minHeight,
      fontSize: button.fontSize,
      fontWeight: button.fontWeight,
    };
  });

  expect(style.borderTopWidth).toBe('1px');
  expect(style.borderTopStyle).toBe('solid');
  expect(style.borderTopColor).toBe('rgb(207, 222, 216)'); // --line 浅色 #cfded8
  expect(style.color).toBe('rgb(89, 106, 103)');           // --muted 浅色 #596a67
  // 层级差只由颜色承担：尺寸与普通条目一致。
  expect(style.minHeight).toBe('44px');
  expect(style.fontSize).toBe('14px');
  expect(style.fontWeight).toBe('400');
});

test('设置入口悬停回到主文字色、被选中时回到动作色', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  const settings = dashboard.getByRole('button', { name: '设置', exact: true });

  await settings.hover();
  await expect.poll(() => settings.evaluate((node) => getComputedStyle(node).color))
    .toBe('rgb(24, 51, 49)'); // --ink 浅色 #183331

  await settings.click();
  await expect(dashboard.locator('#page-title')).toHaveText('设置');

  const current = await settings.evaluate((node) => {
    const style = getComputedStyle(node);
    return { color: style.color, fontWeight: style.fontWeight, borderLeftColor: style.borderLeftColor };
  });
  expect(current.color).toBe('rgb(39, 107, 108)');        // --teal 浅色 #276b6c
  expect(current.fontWeight).toBe('700');
  expect(current.borderLeftColor).toBe('rgb(39, 107, 108)');
});

test('深色主题下侧栏分隔线仍与画布背景可区分', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  const style = await dashboard.evaluate(() => ({
    border: getComputedStyle(document.querySelector('.nav__footer')).borderTopColor,
    canvas: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
  }));

  expect(style.border).toBe('rgb(49, 80, 75)');  // --line 深色 #31504b
  expect(style.canvas).toBe('rgb(16, 32, 31)');  // --canvas 深色 #10201f
  expect(style.border).not.toBe(style.canvas);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx playwright test tests/e2e/sidebar-navigation.spec.js --output="$env:TEMP\worktodo-pw-out"`

Expected: Task 2 的两个用例通过；新增三个失败——「系统」标签仍然存在（`toHaveCount(0)` 失败）、`borderTopWidth` 是 `0px`、按钮颜色是 `rgb(24, 51, 49)`。

- [ ] **Step 3: 删除「系统」分组标签**

`src/dashboard/index.html` 的底部区里删掉这一行：

```html
          <p class="nav__label">系统</p>
```

- [ ] **Step 4: 添加分隔线与弱化色规则**

`src/dashboard/index.css` 中，在现有 `.nav__settings` 声明块（第 112-116 行）**之后**新增：

```css
/* 设置是次级入口，层级差由分隔线与颜色承担，不由尺寸承担：
   44px 是既有触控目标，缩小字号也违反规范 §6.1。
   这组规则必须排在选中态规则之后——特异性与 .nav button[aria-current="page"]
   相同，靠顺序决定胜负，顺序写反会让选中态退回灰色。 */
.nav__footer {
  margin-top: 0;
  padding-top: var(--sp-4);
  border-top: 1px solid var(--line);
}
.nav__footer button { color: var(--muted); }
.nav__footer button:hover { color: var(--ink); }
.nav__footer button[aria-current="page"] { color: var(--teal); }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx playwright test tests/e2e/sidebar-navigation.spec.js --output="$env:TEMP\worktodo-pw-out"`

Expected: 5 passed。

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/index.html src/dashboard/index.css tests/e2e/sidebar-navigation.spec.js
git commit -m "优化：设置入口改用分隔线与弱化色表达层级"
```

---

### Task 4: 收敛 `.nav__settings` 与 `.nav button` 的重复声明

这是一次纯重构，没有新行为。测试是回归安全网，**预期在改动前后都通过**——它证明删除类名没有改变任何计算样式。

**Files:**
- Modify: `src/dashboard/index.html`（删掉设置按钮上的 `class="nav__settings"`）
- Modify: `src/dashboard/index.css:66-67`、`:82-85`、`:112-116`
- Test: `tests/e2e/sidebar-navigation.spec.js`（追加用例）

**Interfaces:**
- Consumes: Task 2、Task 3 的最终视觉状态
- Produces: 侧栏条目唯一的选择器来源 `.nav button`；`.nav__settings` 这个类名此后在仓库中不再存在

- [ ] **Step 1: 先写回归断言，确认它当前就通过**

在 `tests/e2e/sidebar-navigation.spec.js` 末尾追加：

```js
test('设置条目与普通导航项共用同一组基础样式', async ({ extension }) => {
  const dashboard = await openDashboard(extension);

  const read = (route) => dashboard.evaluate((selector) => {
    const style = getComputedStyle(document.querySelector(selector));
    return {
      minHeight: style.minHeight,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      borderRadius: style.borderRadius,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      borderLeftWidth: style.borderLeftWidth,
    };
  }, `[data-route="${route}"]`);

  // 颜色与上边框是刻意保留的差异，所以这里只比对几何与排版。
  expect(await read('settings')).toEqual(await read('history'));
});
```

Run: `npx playwright test tests/e2e/sidebar-navigation.spec.js --grep "共用同一组基础样式" --output="$env:TEMP\worktodo-pw-out"`

Expected: 1 passed。此时 `.nav__settings` 的声明仍在，但取值与基础规则相同，所以断言成立——这正是重构前后应当保持的不变量。

- [ ] **Step 2: 从选择器组里移除 `.nav__settings`**

`src/dashboard/index.css` 四处改动：

第 66-67 行，把

```css
.nav button,
.nav__settings {
```

改为

```css
.nav button {
```

第 82-83 行，把

```css
.nav button:hover,
.nav__settings:hover { background: var(--nav-hover); }
```

改为

```css
.nav button:hover { background: var(--nav-hover); }
```

第 84-85 行，把

```css
.nav button[aria-current="page"],
.nav__settings[aria-current="page"] {
```

改为

```css
.nav button[aria-current="page"] {
```

第 112-116 行，整块删除：

```css
/* 设置与普通条目共用同一条左侧选中标记（吸底由 .nav__footer 负责）。 */
.nav__settings {
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  padding-inline: var(--sp-3);
}
```

- [ ] **Step 3: 删掉按钮上的类名**

`src/dashboard/index.html` 中，把

```html
            <button class="nav__settings" type="button" data-route="settings">设置</button>
```

改为

```html
            <button type="button" data-route="settings">设置</button>
```

- [ ] **Step 4: 确认 HTML 里已无该类名**

Run: `Get-ChildItem -Recurse -Include *.html src | Select-String -Pattern "nav__settings"`

Expected: 无输出。`src/dashboard/index.css` 里还会剩两条窄屏媒体块中的 `.nav__settings` 声明（B 段第 1228-1229 行），它们由 Task 5 删除——本任务只负责让按钮不再带这个类。

- [ ] **Step 5: 运行测试确认仍然通过**

Run: `npx playwright test tests/e2e/sidebar-navigation.spec.js --output="$env:TEMP\worktodo-pw-out"`

Expected: 6 passed，其中「共用同一组基础样式」仍然通过——几何与排版在重构前后完全一致。

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/index.html src/dashboard/index.css tests/e2e/sidebar-navigation.spec.js
git commit -m "重构：合并侧栏设置入口与普通导航项的重复样式"
```

---

### Task 5: 清理窄屏媒体查询里的重复声明

同样是纯重构：只删除被后一段覆盖或本身就是死声明的行，不合并两个媒体块。测试是回归安全网。

**Files:**
- Modify: `src/dashboard/index.css:1137`、`:1139-1147`、`:1149`、`:1150`、`:1151-1157`、`:1159`、`:1160-1161`、`:1185`、`:1222`
- Test: `tests/e2e/sidebar-navigation.spec.js`（追加用例）

**Interfaces:**
- Consumes: Task 2–4 完成后的侧栏结构
- Produces: 两个 `@media (max-width: 680px)` 块中不再有重复或冲突的外壳声明；`.nav button[aria-current="page"]` 的下边框规则保留为窄屏选中态唯一来源

- [ ] **Step 1: 先写回归断言，确认它当前就通过**

在 `tests/e2e/sidebar-navigation.spec.js` 末尾追加：

```js
test('390px 下侧栏排布、选中态与分隔线保持不变', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 390, height: 844 });

  const nav = await dashboard.evaluate(() => {
    const navStyle = getComputedStyle(document.querySelector('.nav'));
    return {
      direction: navStyle.flexDirection,
      wrap: navStyle.flexWrap,
      groupBasis: getComputedStyle(document.querySelector('.nav__group')).flexBasis,
      sidebarPosition: getComputedStyle(document.querySelector('.sidebar')).position,
      labelDisplay: getComputedStyle(document.querySelector('.nav__label')).display,
      footerBorder: getComputedStyle(document.querySelector('.nav__footer')).borderTopWidth,
    };
  });
  expect(nav.direction).toBe('row');
  expect(nav.wrap).toBe('wrap');
  expect(nav.groupBasis).toBe('140px');
  expect(nav.sidebarPosition).toBe('static');
  expect(nav.labelDisplay).toBe('none');
  expect(nav.footerBorder).toBe('1px');

  // 窄屏选中标记从左侧竖条换成下边框。
  await dashboard.getByRole('button', { name: '明天', exact: true }).click();
  const marker = await dashboard.evaluate(() => {
    const style = getComputedStyle(document.querySelector('[data-route="tomorrow"]'));
    return { bottom: style.borderBottomColor, left: style.borderLeftWidth };
  });
  expect(marker.bottom).toBe('rgb(39, 107, 108)');
  expect(marker.left).toBe('0px');
});

test('390px 下导航条目全部可见且没有横向溢出', async ({ extension }) => {
  const dashboard = await openDashboard(extension);
  await dashboard.setViewportSize({ width: 390, height: 844 });

  const labels = ['今天', '明天', '本周', '月历', '收集箱', '资料收集箱', '全部任务', '已完成', '回收站', '工作记录', '设置'];
  for (const label of labels) {
    await expect(dashboard.getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await dashboard.getByLabel('记录一个新事项').fill('窄屏侧栏任务');
  await dashboard.getByRole('button', { name: '记录', exact: true }).click();
  await expect(dashboard.getByRole('button', { name: '窄屏侧栏任务' })).toBeVisible();

  const layout = await dashboard.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    contentPaddingBottom: getComputedStyle(document.querySelector('.content')).paddingBottom,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  // A 段那个 140px 底部内边距早已被 B 段覆盖，取两者中生效的值。
  expect(layout.contentPaddingBottom).toBe('24px');
});
```

Run: `npx playwright test tests/e2e/sidebar-navigation.spec.js --grep "390px" --output="$env:TEMP\worktodo-pw-out"`

Expected: 2 passed（此时重复声明还在，B 段的值已经在生效）。

- [ ] **Step 2: 合并 `.sidebar` 的窄屏声明**

`.sidebar` 是规范 §4.4 表里唯一需要"搬家"而不是"删除"的一项：A 段第 1139-1147 行的七条属性与 B 段第 1215 行的 `flex: none` 不冲突，但同一个选择器被拆在两处。把 A 段那一整块**移动到** B 段第 1213 行的媒体块内、`flex: none` 旁边，A 段原位置删除：

```css
  .sidebar {
    position: static;
    gap: var(--sp-3);
    height: auto;
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--line);
    padding: var(--sp-4) var(--sp-5);
  }
```

完成后 `.sidebar` 在窄屏只有一处声明。这一步是纯搬家，`sidebarPosition` 等计算值不变。

- [ ] **Step 3: 删除 A 段中被覆盖或失效的外壳声明**

`src/dashboard/index.css` 第 1136-1204 行的媒体块里，删除以下各行：

```css
  .app { grid-template-columns: 1fr; }
```

（`.app` 是 flex 容器，`grid-template-columns` 不生效；B 段第 1214 行的 `display: block` 才是生效的那条。）

```css
  .nav { grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: visible; }
```

（`.nav` 是 flex 容器，`grid-template-columns` 不生效；`overflow: visible` 在 `.sidebar { height: auto }` 下与 base 的 `overflow-y: auto` 无差异。）

```css
  .nav__label { display: none; }
```

（被 B 段第 1222 行覆盖。）

```css
  .nav button {
    border-left: 0;
    border-bottom: 2px solid transparent;
    border-radius: var(--r-sm) var(--r-sm) 0 0;
    padding: var(--sp-2) var(--sp-3);
    font-size: var(--fs-body);
  }
```

（被 B 段第 1225 行覆盖；`font-size: var(--fs-body)` 与 base 的 `--fs-nav-item` 同为 14px，是空操作。）

```css
  .nav__settings { margin-top: var(--sp-2); padding-inline: var(--sp-3); }
```

（被 B 段第 1228 行覆盖，且类名已在 Task 4 删除。）

```css
  .content { padding: var(--sp-7) var(--sp-5) 140px; }
```

（被 B 段第 1230 行覆盖。）

```css
  .history-report-top { grid-template-columns: 1fr; }
```

（与 B 段第 1239 行完全同值，纯重复。）

**必须保留**：

```css
  .nav button[aria-current="page"] { border-bottom-color: var(--teal); }
```

这是窄屏下边框选中态的唯一来源，B 段没有对应规则，删掉会让窄屏失去选中标记。

`.brand { margin: 0 0 var(--sp-2); }`（第 1148 行）与 B 段 `.brand-lockup`（第 1216 行）不是重复，但两者底边距可能叠加成 8px。**本任务不动它**：先按现状保留，如需调整另开任务。

- [ ] **Step 4: 删除窄屏下遗留的 `.nav__settings` 声明并简化分组标签规则**

Task 4 只删掉了主规则组里的 `.nav__settings`；B 段媒体块里的两条还在，但类名已从 HTML 移除，它们已是死声明。删除这两行及其上方注释「窄屏选中标记从左侧竖条换成下边框。」：

```css
  .nav__settings { width: 100%; margin-top: 0; border-left: 0; border-bottom: 2px solid transparent; border-radius: var(--r-sm) var(--r-sm) 0 0; }
  .nav__settings[aria-current="page"] { border-bottom-color: var(--teal); }
```

那条注释描述的行为现在由 `.nav button[aria-current="page"]` 承担，所以注释跟着删。

B 段第 1226 行的 `.nav__footer { margin-top: var(--sp-2); }` 保留不动。

B 段第 1222 行，把

```css
  .nav__group .nav__label, .nav__footer .nav__label { display: none; }
```

改为

```css
  .nav__label { display: none; }
```

（底部区已没有分组标签，选择器不必再区分。）

- [ ] **Step 5: 确认类名已彻底无残留**

Run: `Get-ChildItem -Recurse -Include *.js,*.css,*.html src,tests | Select-String -Pattern "nav__settings"`

Expected: 无输出。这是整个重构的收尾检查——Task 4 之后它仍会命中 `index.css`，本任务结束后必须彻底消失。

- [ ] **Step 6: 运行测试确认仍然通过**

Run: `npx playwright test tests/e2e/sidebar-navigation.spec.js --output="$env:TEMP\worktodo-pw-out"`

Expected: 8 passed。

- [ ] **Step 7: 跑全量 E2E 确认没有跨页面回归**

Run: `npx playwright test --output="$env:TEMP\worktodo-pw-out"`

Expected: 78 passed（70 个既有用例 + 本计划新增 8 个）。这一步是必须的：媒体查询里删掉的行覆盖整个工作台，不只侧栏。

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/index.css tests/e2e/sidebar-navigation.spec.js
git commit -m "重构：清理侧栏在窄屏下的重复媒体查询声明"
```

---

### Task 6: 升级版本号、全量回归与打包

**Files:**
- Modify: `manifest.json:4`
- 产物：`dist/WorkTodo-v1.7.1.zip`

**Interfaces:**
- Consumes: Task 1–5 的全部改动
- Produces: 可导入 Chromium 的发布包

- [ ] **Step 1: 升级版本号**

把 `manifest.json` 的

```json
  "version": "1.7.0",
```

改为

```json
  "version": "1.7.1",
```

- [ ] **Step 2: 跑单元测试**

Run: `npm run test:unit`

Expected: `pass 216`、`fail 0`。

- [ ] **Step 3: 跑全量 E2E**

Run: `npx playwright test --output="$env:TEMP\worktodo-pw-out"`

Expected: 78 passed、0 failed。

- [ ] **Step 4: 打包**

Run: `npm run package`

Expected: 输出 `dist/WorkTodo-v1.7.1.zip`，且不报错。

- [ ] **Step 5: 核对产物**

Run: `Get-ChildItem dist | ForEach-Object { "$($_.Name)  $($_.Length) bytes" }`

Expected: 出现 `WorkTodo-v1.7.1.zip`；不应出现 `WorkTodo-v1.7.0.zip` 之外的新包名。

- [ ] **Step 6: 人工验证 200% 缩放**

Run: 在 Chrome/Edge 打开扩展工作台（`chrome-extension://<扩展 id>/src/dashboard/index.html`），窗口宽度设为约 1280px，按 `Ctrl` + `+` 放大到 200%。

Expected: 侧栏不出现横向滚动条；分隔线可见；`设置` 仍可点击并进入设置页。

这一条刻意不写成自动化断言：Playwright 无法设置浏览器缩放，而对 `<html>` 施加 CSS `zoom` 会改变 `scrollWidth` / `clientWidth` 的语义，写出来的断言容易假阳性。这是规范 §6 验收项中唯一需要人工确认的一条。

- [ ] **Step 7: Commit**

```bash
git add manifest.json
git commit -m "构建：升级到 v1.7.1 并生成发布包"
```

- [ ] **Step 8: 交付说明**

工作到此停止。tag 与 GitHub Release 不在本计划范围内（用户已明确本次不发布）。如果之后要发布，按 `AGENTS.md`「版本与 GitHub 发布」补齐：带注释 tag `v1.7.1`、上传 `dist/WorkTodo-v1.7.1.zip`，并在 `docs/releases.md` 追加六项记录。

---

## 未纳入本次范围（已确认不做）

- 不重排「计划 / 任务 / 回顾」分组，不移动「资料收集箱」。
- 不引入图标或任何 SVG 资源。
- 不新增路由、子路由或 hash 参数；设置页内容与信息架构不变。
- 不把两个 `@media (max-width: 680px)` 块硬合并为一段。
- 不修改 `src/dashboard/index.js`、`dashboard-controller.js`、`views/settings-view.js`。
- 不修改 `README.md`、`docs/superpowers/specs/2026-09-18-worktodo-ux-v1.1-design.md`、`docs/releases.md`。
- 不处理权威规范 §2.4 与 `src/dashboard/hash.js` 之间的既有文档漂移（"不使用 URL 或 hash 记录路由" vs 实现已用 hash 路由）。
