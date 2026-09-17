import { escapeHtml } from '../../shared/ui.js';
import { renderTaskList } from '../task-list.js';

const EMPTY_FILTERS = Object.freeze({
  text: '',
  lifecycle: '',
  fromDate: '',
  toDate: '',
  categoryId: '',
  tagId: '',
  priority: '',
  starred: '',
});

function categoryOptions(categories, selected) {
  return [
    `<option value="" ${selected === '' ? 'selected' : ''}>全部分类</option>`,
    `<option value="__none" ${selected === '__none' ? 'selected' : ''}>未分类</option>`,
    ...categories.map((item) => `<option value="${escapeHtml(item.id)}" ${selected === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`),
  ].join('');
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

export function createAllTasksView({ root, query, taskService, tagService, today, onAction, onEdit, onError }) {
  let filters = { ...EMPTY_FILTERS };
  let categories = [];
  let tags = [];
  let searchTimer;

  async function refreshList(signal) {
    const listRoot = root.querySelector('#all-tasks-list');
    if (listRoot === null) return;
    const tasks = await query.search(queryFilters(filters));
    if (signal?.aborted) return;
    renderTaskList(listRoot, tasks, {
      today: today(),
      onAction,
      onEdit,
      onError,
      tags,
      emptyMessage: '没有符合当前筛选条件的任务。',
    });
    root.querySelector('#filter-count').textContent = `显示 ${tasks.length} 项`;
  }

  function readFilters() {
    const form = root.querySelector('#task-filters');
    filters = Object.fromEntries(new FormData(form).entries());
  }

  return {
    async render(signal) {
      [categories, tags] = await Promise.all([
        taskService.listCategories(),
        tagService.list(),
      ]);
      if (signal?.aborted) return;
      root.innerHTML = `<section class="view-section" aria-labelledby="all-tasks-heading">
        <div class="section-heading">
          <div><h2 id="all-tasks-heading">全部任务</h2><p>筛选条件始终可见，可单独清除，也可一次清空。</p></div>
          <span id="filter-count" class="filter-count">显示 0 项</span>
        </div>
        <form class="filters" id="task-filters">
          <label class="filter-search">搜索<input type="search" name="text" value="${escapeHtml(filters.text)}" placeholder="标题或描述"></label>
          <label>状态<select name="lifecycle">
            <option value="">全部</option><option value="todo" ${filters.lifecycle === 'todo' ? 'selected' : ''}>待办</option><option value="in_progress" ${filters.lifecycle === 'in_progress' ? 'selected' : ''}>进行中</option><option value="completed" ${filters.lifecycle === 'completed' ? 'selected' : ''}>已完成</option><option value="cancelled" ${filters.lifecycle === 'cancelled' ? 'selected' : ''}>已取消</option>
          </select></label>
          <label>从<input type="date" name="fromDate" value="${filters.fromDate}"></label>
          <label>到<input type="date" name="toDate" value="${filters.toDate}"></label>
          <label>分类<select name="categoryId">${categoryOptions(categories, filters.categoryId)}</select></label>
          <label>标签<select name="tagId" aria-label="标签">${tagOptions(tags, filters.tagId)}</select></label>
          <label>优先级<select name="priority">
            <option value="">全部</option><option value="high" ${filters.priority === 'high' ? 'selected' : ''}>高</option><option value="medium" ${filters.priority === 'medium' ? 'selected' : ''}>中</option><option value="low" ${filters.priority === 'low' ? 'selected' : ''}>低</option><option value="none" ${filters.priority === 'none' ? 'selected' : ''}>无</option>
          </select></label>
          <label>星标<select name="starred"><option value="">全部</option><option value="true" ${filters.starred === 'true' ? 'selected' : ''}>仅星标</option><option value="false" ${filters.starred === 'false' ? 'selected' : ''}>未星标</option></select></label>
          <button type="button" class="button-secondary" id="clear-filters">清空筛选</button>
        </form>
        <div id="all-tasks-list"></div>
      </section>`;
      const form = root.querySelector('#task-filters');
      form.addEventListener('input', (event) => {
        readFilters();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => refreshList(signal), event.target.type === 'search' ? 150 : 0);
      });
      form.addEventListener('change', () => {
        readFilters();
        refreshList(signal);
      });
      root.querySelector('#clear-filters').addEventListener('click', () => {
        filters = { ...EMPTY_FILTERS };
        return this.render(signal);
      });
      await refreshList(signal);
    },
  };
}
