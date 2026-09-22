import { escapeHtml, runViewAction } from '../../shared/ui.js';
import { readFilters as readHashFilters, writeParams } from '../hash.js';
import { renderTaskList, renderTaskRow, arrangeSubtasks } from '../task-list.js';
import { patchTaskContainers } from '../list-patch.js';

const EMPTY_FILTERS = Object.freeze({
  text: '',
  lifecycle: '',
  fromDate: '',
  toDate: '',
  categoryId: '',
  tagId: '',
  priority: '',
  starred: '',
  hasResources: '',
});

function categoryOptions(categories, selected) {
  return [
    `<option value="" ${selected === '' ? 'selected' : ''}>全部列表</option>`,
    `<option value="__none" ${selected === '__none' ? 'selected' : ''}>未归入列表</option>`,
    ...categories.map((item) => `<option value="${escapeHtml(item.id)}" ${selected === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`),
  ].join('');
}

/* 只有搜索和状态常驻：其余条件低频且多数时候用不到，
   平铺 9 个字段会把"找回一件事"变成填数据库表单（规范 §4.15）。 */
const ADVANCED_FILTER_KEYS = ['fromDate', 'toDate', 'categoryId', 'tagId', 'priority', 'starred', 'hasResources'];

function hashFilters() {
  return { ...EMPTY_FILTERS, ...readHashFilters() };
}

function activeFilterCount(filters) {
  return Object.keys(EMPTY_FILTERS).filter((key) => filters[key] !== '').length;
}

function advancedFilterCount(filters) {
  return ADVANCED_FILTER_KEYS.filter((key) => filters[key] !== '').length;
}

/* 空值统一成 ''：HTMLFormControlsCollection 在 name 重复时会返回 RadioNodeList，
   按 FormData 逐字段归一，保证 filters 始终是“键全在、值为字符串”的普通对象。 */
function normalizeFilters(source) {
  const normalized = { ...EMPTY_FILTERS };
  for (const key of Object.keys(EMPTY_FILTERS)) {
    const value = source.get(key);
    normalized[key] = typeof value === 'string' ? value : '';
  }
  return normalized;
}

function tagOptions(tags, selected) {
  return [
    `<option value="" ${selected === '' ? 'selected' : ''}>全部标签</option>`,
    ...tags.map((tag) => `<option value="${escapeHtml(tag.id)}" ${selected === tag.id ? 'selected' : ''}>${escapeHtml(tag.name)}</option>`),
  ].join('');
}

function queryFilters(filters) {
  return {
    text: filters.text,
    ...(filters.lifecycle === '' ? {} : { lifecycle: filters.lifecycle }),
    ...(filters.fromDate === '' ? {} : { fromDate: filters.fromDate }),
    ...(filters.toDate === '' ? {} : { toDate: filters.toDate }),
    ...(filters.categoryId === '' ? {} : { categoryId: filters.categoryId === '__none' ? null : filters.categoryId }),
    ...(filters.tagId === '' ? {} : { tagId: filters.tagId }),
    ...(filters.priority === '' ? {} : { priority: filters.priority }),
    ...(filters.starred === '' ? {} : { starred: filters.starred === 'true' }),
  };
}

export function createAllTasksView({ root, query, taskService, tagService, today, onAction, onEdit, onError, getResourceCounts, resourceService }) {
  let filters = hashFilters();
  let categories = [];
  let tags = [];
  let searchTimer;
  let listVersion = 0;
  // 高级筛选的展开态不进 hash：它是"我正在看哪几个条件"的临时姿势，
  // 真正的条件是 filter 值本身——有条件时面板自动展开，无条件时保持收起。
  let advancedOpen = false;

  async function refreshList(signal) {
    const requestedVersion = ++listVersion;
    if (signal?.aborted) return;
    const listRoot = root.querySelector('#all-tasks-list');
    if (listRoot === null) return;
    let tasks;
    try {
      tasks = await query.search(queryFilters(filters));
    } catch (error) {
      if (signal?.aborted || requestedVersion !== listVersion || error?.name === 'AbortError') return;
      throw error;
    }
    if (signal?.aborted || !listRoot.isConnected || requestedVersion !== listVersion) return;
    const resourceCounts = await getResourceCounts?.(tasks) ?? new Map();
    const visibleTasks = filters.hasResources === 'true'
      ? tasks.filter((task) => (resourceCounts.get(task.id) ?? 0) > 0)
      : filters.hasResources === 'false'
        ? tasks.filter((task) => (resourceCounts.get(task.id) ?? 0) === 0)
        : tasks;
    const { topLevel, childrenByParent } = await arrangeSubtasks(query, visibleTasks);
    const filterCount = root.querySelector('#filter-count');
    if (filterCount === null) return;
    renderTaskList(listRoot, topLevel, {
      today: today(),
      onAction,
      onEdit,
      onError,
      tags,
      resourceCounts,
      childrenByParent,
      // 筛选后为空时必然至少有一个条件，此时“清空筛选”一定可见，
      // 所以这里只说动作、不用描述方位。
      emptyMessage: '没有符合当前筛选条件的任务，调整条件或清空筛选即可回到全部结果。',
    });
    filterCount.textContent = `显示 ${topLevel.length} 项`;
  }

  function readFilters() {
    const form = root.querySelector('#task-filters');
    filters = normalizeFilters(new FormData(form));
    // 筛选即状态：写回 hash，刷新、后退和收藏都能回到同一份结果。
    writeParams(filters);
    syncFilterControls();
  }

  /* 面板展开态、角标计数和「清空筛选」的可显性统一在这里收口，
     不再靠多处手动开关：展开态只由 advancedOpen 决定（渲染时按 hash 里的条件初始化），
     计数与清空按钮由当前条件推导，避免"面板收着但条件还在生效"却没有提示。 */
  function syncFilterControls() {
    const panel = root.querySelector('#advanced-filters');
    const toggle = root.querySelector('#toggle-advanced');
    const badge = root.querySelector('#advanced-count');
    const badgeValue = badge?.querySelector('[data-advanced-count]');
    const clear = root.querySelector('#clear-filters');
    if (panel === null || toggle === null || badgeValue === null || clear === null) return;
    const advanced = advancedFilterCount(filters);
    panel.hidden = !advancedOpen;
    toggle.setAttribute('aria-expanded', String(advancedOpen));
    // 只改数字、保留两侧的 sr-only 说明，可访问名始终是"已启用 N 项"。
    badgeValue.textContent = String(advanced);
    badge.hidden = advanced === 0;
    clear.hidden = activeFilterCount(filters) === 0;
  }

  return {
    async render(signal) {
      // hash 是筛选的唯一来源：导航离开再回来（或在地址栏改条件）都以它为准。
      filters = hashFilters();
      [categories, tags] = await Promise.all([
        taskService.listCategories(),
        tagService.list(),
      ]);
      if (signal?.aborted) return;
      // hash 里带着高级条件（刷新、收藏深链、后退回来）时面板直接展开：
      // 收着却仍在生效的条件会让用户以为自己看到的是全部任务。
      advancedOpen = advancedFilterCount(filters) > 0;
      const advancedCount = advancedFilterCount(filters);
      const activeCount = activeFilterCount(filters);
      root.innerHTML = `<section class="view-section" aria-labelledby="all-tasks-heading">
        <div class="section-heading">
          <div><h2 id="all-tasks-heading">全部任务</h2><p>搜索和状态常驻，时间、列表、标签等条件收在“高级筛选”里。</p></div>
          <span id="filter-count" class="filter-count">显示 0 项</span>
        </div>
        <form class="filters" id="task-filters">
          <div class="filters__primary">
            <label class="filter-search">搜索<input type="search" name="text" value="${escapeHtml(filters.text)}" placeholder="标题或描述" aria-keyshortcuts="f"></label>
            <label>状态<select name="lifecycle">
              <option value="">全部</option><option value="todo" ${filters.lifecycle === 'todo' ? 'selected' : ''}>待办</option><option value="in_progress" ${filters.lifecycle === 'in_progress' ? 'selected' : ''}>进行中</option><option value="completed" ${filters.lifecycle === 'completed' ? 'selected' : ''}>已完成</option><option value="cancelled" ${filters.lifecycle === 'cancelled' ? 'selected' : ''}>已取消</option>
            </select></label>
            <div class="filters__actions">
              <button type="button" class="button-text" id="toggle-advanced" aria-controls="advanced-filters" aria-expanded="${advancedOpen}">高级筛选<span class="filters__badge" id="advanced-count"${advancedCount === 0 ? ' hidden' : ''}><span class="sr-only">已启用 </span><span data-advanced-count>${advancedCount}</span><span class="sr-only"> 项</span></span></button>
              <button type="button" class="button-text" id="clear-filters"${activeCount === 0 ? ' hidden' : ''}>清空筛选</button>
            </div>
          </div>
          <div class="filters__advanced" id="advanced-filters"${advancedOpen ? '' : ' hidden'}>
            <label>从<input type="date" name="fromDate" value="${filters.fromDate}"></label>
            <label>到<input type="date" name="toDate" value="${filters.toDate}"></label>
            <label>列表<select name="categoryId">${categoryOptions(categories, filters.categoryId)}</select></label>
            <label>标签<select name="tagId" aria-label="标签">${tagOptions(tags, filters.tagId)}</select></label>
            <label>优先级<select name="priority">
              <option value="">全部</option><option value="high" ${filters.priority === 'high' ? 'selected' : ''}>高</option><option value="medium" ${filters.priority === 'medium' ? 'selected' : ''}>中</option><option value="low" ${filters.priority === 'low' ? 'selected' : ''}>低</option><option value="none" ${filters.priority === 'none' ? 'selected' : ''}>无</option>
            </select></label>
            <label>星标<select name="starred"><option value="">全部</option><option value="true" ${filters.starred === 'true' ? 'selected' : ''}>仅星标</option><option value="false" ${filters.starred === 'false' ? 'selected' : ''}>未星标</option></select></label>
            <label>资料<select name="hasResources"><option value="">全部</option><option value="true" ${filters.hasResources === 'true' ? 'selected' : ''}>有资料</option><option value="false" ${filters.hasResources === 'false' ? 'selected' : ''}>无资料</option></select></label>
          </div>
        </form>
        <div id="all-tasks-list"></div>
      </section>`;
      syncFilterControls();
      const form = root.querySelector('#task-filters');
      root.querySelector('#toggle-advanced').addEventListener('click', () => {
        const panel = root.querySelector('#advanced-filters');
        advancedOpen = panel.hidden;
        syncFilterControls();
        // 展开后焦点落进面板首个控件，键盘用户不必再自己找一遍入口。
        if (advancedOpen) panel.querySelector('input, select')?.focus();
      });
      form.addEventListener('input', (event) => {
        readFilters();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          runViewAction(() => refreshList(signal), { signal, onError });
        }, event.target.type === 'search' ? 150 : 0);
      });
      form.addEventListener('change', () => {
        readFilters();
        runViewAction(() => refreshList(signal), { signal, onError });
      });
      root.querySelector('#clear-filters').addEventListener('click', () => {
        filters = { ...EMPTY_FILTERS };
        advancedOpen = false;
        writeParams(filters);
        runViewAction(() => this.render(signal), { signal, onError });
      });
      await refreshList(signal);
    },

    async patch(signal) {
      let tasks;
      try {
        tasks = await query.search(queryFilters(filters));
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') return;
        await this.render(signal);
        return;
      }
      if (signal?.aborted) return;
      const resourceCounts = await getResourceCounts?.(tasks) ?? new Map();
      const visibleTasks = filters.hasResources === 'true'
        ? tasks.filter((task) => (resourceCounts.get(task.id) ?? 0) > 0)
        : filters.hasResources === 'false'
          ? tasks.filter((task) => (resourceCounts.get(task.id) ?? 0) === 0)
          : tasks;
      if (signal?.aborted) return;
      const { topLevel, childrenByParent } = await arrangeSubtasks(query, visibleTasks);
      if (signal?.aborted) return;
      const patched = patchTaskContainers(root, [
        { container: root.querySelector('#all-tasks-list'), tasks: topLevel },
      ], {
        renderRow: (task) => renderTaskRow(task, { today: today(), tags, resourceCounts, childrenByParent }),
        collectCounts: () => ({ '#filter-count': `显示 ${topLevel.length} 项` }),
      });
      if (patched === false) await this.render(signal);
    },
  };
}
