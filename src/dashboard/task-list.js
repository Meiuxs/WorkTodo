import { formatLocalDay, toLocalDate } from '../domain/dates.js';
import { isSubtask } from '../domain/task.js';
import { escapeHtml } from '../shared/ui.js';

const ACTIVE_LIFECYCLES = new Set(['todo', 'in_progress']);

/* 子任务 id 可能含特殊字符，查询选择器前转义；无 CSS.escape 时退化为手动转义引号/反斜杠。 */
function cssEscape(value) {
  return typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(value)
    : String(value).replace(/["\\]/g, '\\$&');
}

/* 视图在渲染前用这个把子任务归位：
   - childrenByParent：给定任务集合里所有顶层任务的子任务（含已完成/已取消，不含回收站），供父行内联嵌套；
   - topLevel：从集合中移除“父任务也在本集合里”的子任务，避免既平铺又嵌套重复出现；
     父任务不在本集合（例如计划日期不同）时子任务仍平铺保留，确保子任务永不消失。 */
export async function arrangeSubtasks(query, tasks) {
  const parentIds = tasks.filter((task) => !isSubtask(task)).map((task) => task.id);
  const childrenByParent = parentIds.length > 0 ? await query.subtasksByParent(parentIds) : new Map();
  const parentSet = new Set(parentIds);
  const topLevel = tasks.filter((task) => !isSubtask(task) || !parentSet.has(task.parentId));
  return { topLevel, childrenByParent };
}

function offsetDate(date, days) {
  return toLocalDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function localDateTime(value) {
  if (value === null) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function getScheduleOptions(today) {
  const date = new Date(`${today}T00:00:00`);
  const weekday = date.getDay();
  const daysUntilNextMonday = ((1 - weekday + 7) % 7) || 7;
  return [
    { value: today, label: '今天' },
    { value: offsetDate(date, 1), label: '明天' },
    { value: offsetDate(date, 2), label: '后天' },
    { value: offsetDate(date, daysUntilNextMonday), label: '下周一' },
    { value: offsetDate(date, 7), label: '下周' },
  ];
}

export function taskMeta(task, today) {
  if (task.trashedAt !== null) return '可恢复';
  if (task.lifecycle === 'completed') return localDateTime(task.completedAt);
  if (task.lifecycle === 'cancelled') {
    if (task.cancelledAt !== null && task.cancelledAt !== undefined) {
      return localDateTime(task.cancelledAt);
    }
  }
  if (task.scheduledDate !== null && task.scheduledDate < today) {
    return `原计划 ${formatLocalDay(task.scheduledDate)}`;
  }
  if (task.startTime !== null && task.dueTime !== null) return `${task.startTime}–${task.dueTime}`;
  if (task.startTime !== null) return task.startTime;
  if (task.lifecycle === 'cancelled') return task.scheduledDate === null ? '无计划日期' : formatLocalDay(task.scheduledDate);
  if (task.scheduledDate === today) return '今天 · 无时间';
  return task.scheduledDate === null ? '收集箱' : `${formatLocalDay(task.scheduledDate)} · 无时间`;
}

function taskStatus(task, today) {
  if (task.trashedAt !== null) return '已删除';
  if (task.lifecycle === 'completed') return '已完成';
  if (task.lifecycle === 'cancelled') return '已取消';
  if (task.scheduledDate !== null && task.scheduledDate < today) return '逾期';
  if (task.lifecycle === 'in_progress') return '进行中';
  return '待办';
}

function taskActions(task, today) {
  const actions = [];
  if (task.trashedAt !== null) {
    // 恢复由行首圆环按钮承担，菜单里只留低频的破坏性动作，避免同一动作出现两次。
    actions.push('<button type="button" data-action="delete-permanently">永久删除</button>');
    return actions.join('');
  }
  if (task.lifecycle === 'todo') actions.push('<button type="button" data-action="start">开始</button>');
  if (ACTIVE_LIFECYCLES.has(task.lifecycle)) {
    // 「完成」由行首圆环承担，菜单不再重复；这里只留取消/星标等次级动作。
    actions.push('<button type="button" data-action="cancel">取消</button>');
    actions.push(`<button type="button" data-action="set-starred" data-starred="${task.starred ? 'false' : 'true'}">${task.starred ? '取消星标' : '加星标'}</button>`);
    // 改期是高频动作，但只保留换算好的快捷档；自定义日期和移除日期走编辑抽屉，
    // 优先级同样收进抽屉（行内按 P 循环切换），避免菜单里再套子菜单。
    const quick = getScheduleOptions(today).filter((option) => ['今天', '明天', '下周'].includes(option.label));
    actions.push(`<div class="task__date-group" data-menu-section="date" role="group" aria-label="安排 ${escapeHtml(task.title)}">
      ${quick.map((option) => `<button type="button" data-action="reschedule" data-date="${option.value}">${option.label} · ${formatLocalDay(option.value)}</button>`).join('')}
    </div>`);
  } else {
    actions.push('<button type="button" data-action="restore">恢复待办</button>');
  }
  // 子任务、标签和更多字段都在同一个编辑抽屉里，菜单只保留一个与行为一致的入口。
  actions.push('<button type="button" data-action="edit">编辑任务</button>');
  actions.push('<button type="button" data-action="copy">复制</button>');
  actions.push('<button type="button" data-action="trash">移入回收站</button>');
  return actions.join('');
}

export function taskTagLabel(task, tags) {
  const names = new Map(tags.map((tag) => [tag.id, tag.name]));
  return (task.tagIds ?? [])
    .map((id) => names.get(id))
    .filter(Boolean)
    .map((name) => `#${name}`)
    .join(' ');
}

export function taskPriorityLabel(priority) {
  return ({ none: '无优先级', low: '低优先级', medium: '中优先级', high: '高优先级' })[priority] ?? '无优先级';
}

/* 子任务行：缩进嵌在父任务下方，只保留一个可勾选圆环与标题（点开可编辑）。
   用 data-subtask-id / data-subtask-action 而非 data-task-id，避开 list-patch 扫描器对顶层行的对齐假设。 */
function subtaskMarkup(child, today) {
  const checked = child.lifecycle === 'completed';
  const canRestore = child.lifecycle === 'completed' || child.lifecycle === 'cancelled';
  const action = canRestore ? 'restore' : 'complete';
  const status = taskStatus(child, today);
  return `<li class="task__subtask task__subtask--${escapeHtml(child.lifecycle)}" data-subtask-id="${escapeHtml(child.id)}" data-subtask-revision="${child.revision}">
    <button class="task__subtask-check" type="button" role="checkbox" aria-checked="${checked}" aria-label="完成子任务" data-subtask-action="${action}">${checked ? '✓' : ''}</button>
    <button class="task__subtask-title" type="button" data-subtask-action="edit" title="${escapeHtml(child.title)}">${escapeHtml(child.title)}</button>
    <span class="task__subtask-status">${escapeHtml(status)}</span>
  </li>`;
}

function taskMarkup(task, today, tags, resourceCounts, children = []) {
  const trashed = task.trashedAt !== null;
  const canRestore = trashed || task.lifecycle === 'completed' || task.lifecycle === 'cancelled';
  const checkboxAction = trashed ? 'untrash' : canRestore ? 'restore' : 'complete';
  const checked = !trashed && task.lifecycle === 'completed';
  const status = taskStatus(task, today);
  const tagText = taskTagLabel(task, tags);
  const tagMarkup = tagText.length === 0
    ? ''
    : ` · <span class="task__tags">${escapeHtml(tagText)}</span>`;
  const overdue = task.scheduledDate !== null
    && task.scheduledDate < today
    && ACTIVE_LIFECYCLES.has(task.lifecycle);
  const resourceCount = resourceCounts.get(task.id) ?? 0;
  const resourceLabel = resourceCount > 0 ? ` · 资料 ${resourceCount}` : '';
  const subtaskLabel = children.length > 0
    ? ` · 子任务 ${children.filter((child) => child.lifecycle === 'completed').length}/${children.length}`
    : '';
  const priorityLabel = taskPriorityLabel(task.priority);
  // 隐藏的元信息锚点兼作 P 键循环的当前值载体，避免为快捷键再渲染一个可见控件。
  const priorityMarkup = ` · <span class="task__priority" data-action="cycle-priority" data-priority="${escapeHtml(task.priority)}">${priorityLabel}</span>`;
  // 恢复不是勾选行为：可恢复的行用普通按钮，避免读屏把动作读成复选框的状态切换。
  const checkAttributes = canRestore
    ? 'aria-label="恢复任务"'
    : `role="checkbox" aria-checked="${checked}" aria-label="完成任务"`;
  return `<article class="task task--${escapeHtml(task.lifecycle)}${overdue ? ' task--overdue' : ''}" data-task-id="${escapeHtml(task.id)}" data-revision="${task.revision}" role="listitem">
    <button class="task__check" type="button" ${checkAttributes} data-action="${checkboxAction}">${checked ? '✓' : ''}</button>
    <div class="task__body">
      <button class="task__title" type="button" data-action="edit" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</button>
      <span class="task__meta"><span class="task__status">${status}</span> · ${escapeHtml(taskMeta(task, today))}${priorityMarkup}${task.starred ? ' · 已星标' : ''}${tagMarkup}${subtaskLabel}${resourceLabel}</span>
    </div>
    <details class="task__more">
      <summary aria-label="更多任务操作" aria-haspopup="true" aria-expanded="false">更多</summary>
      <div class="task__menu">
        ${taskActions(task, today)}
      </div>
    </details>
    ${children.length === 0 ? '' : `<ul class="task__subtasks" role="group" aria-label="子任务">${children.map((child) => subtaskMarkup(child, today)).join('')}</ul>`}
  </article>`;
}

export function renderTaskRow(task, { today, tags = [], resourceCounts = new Map(), childrenByParent = new Map() } = {}) {
  return taskMarkup(task, today, tags, resourceCounts, childrenByParent.get(task.id) ?? []);
}

export function renderTaskList(container, tasks, {
  today,
  onAction,
  onEdit,
  onError = () => {},
  emptyMessage = '这里暂时没有任务。',
  tags = [],
  resourceCounts = new Map(),
  childrenByParent = new Map(),
} = {}) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    // 月历格传空字符串表示"这一格不需要占位文案"。此时必须什么都不渲染，
    // 否则空的 <p class="empty"> 会在每个空格子里留下一条悬空横线（.empty 自带下边框）。
    container.innerHTML = emptyMessage === '' ? '' : `<p class="empty">${escapeHtml(emptyMessage)}</p>`;
    container.onclick = null;
    return;
  }

  let visibleCount = Math.min(tasks.length, 200);
  const renderVisible = () => {
    const visibleTasks = tasks.slice(0, visibleCount);
    const more = visibleCount < tasks.length
      ? `<button type="button" class="button-secondary task-list__more" data-load-more>加载更多（还有 ${tasks.length - visibleCount} 项）</button>`
      : '';
    container.innerHTML = `<div class="task-list" role="list">${visibleTasks.map((task) => taskMarkup(task, today, tags, resourceCounts, childrenByParent.get(task.id) ?? [])).join('')}</div>${more}`;
  };
  renderVisible();
  container.onclick = async (event) => {
    const loadMore = event.target.closest('[data-load-more]');
    if (loadMore !== null) {
      visibleCount = Math.min(visibleCount + 200, tasks.length);
      renderVisible();
      return;
    }
    const button = event.target.closest('button[data-action]');
    if (button === null) {
      // 子任务行动作先于顶层行处理：它嵌在父 <article data-task-id> 内，
      // 若不先拦下，会误命中父行的 data-task-id。
      const subButton = event.target.closest('button[data-subtask-action]');
      if (subButton !== null) {
        const subRow = subButton.closest('[data-subtask-id]');
        if (subRow === null) return;
        const subAction = subButton.dataset.subtaskAction;
        const subId = subRow.dataset.subtaskId;
        if (subAction === 'edit') {
          await onEdit?.(subId);
          return;
        }
        subButton.disabled = true;
        try {
          await onAction?.(subAction, subId, Number(subRow.dataset.subtaskRevision));
        } catch (error) {
          onError(error);
        } finally {
          // 子任务状态变化会重渲染整个父行，按 id 重新拿到勾选按钮并恢复焦点。
          const restored = container.querySelector(`[data-subtask-id="${cssEscape(subId)}"] .task__subtask-check`);
          restored?.focus();
        }
      }
      return;
    }
    const row = button.closest('[data-task-id]');
    if (row === null) return;
    const action = button.dataset.action;
    if (action === 'edit') {
      await onEdit?.(row.dataset.taskId);
      return;
    }

    const value = action === 'set-priority'
      ? button.dataset.priority
      : action === 'set-starred'
        ? button.dataset.starred === 'true'
        : button.dataset.date === '' ? null : button.dataset.date;
    button.disabled = true;
    try {
      await onAction?.(action, row.dataset.taskId, Number(row.dataset.revision), value);
    } catch (error) {
      onError(error);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };
  container.onkeydown = async (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['d', 'p'].includes(event.key.toLowerCase())) return;
    if (event.target.closest('input, select, textarea')) return;
    const row = event.target.closest('[data-task-id]');
    if (row === null) return;
    if (event.key.toLowerCase() === 'p') {
      // 优先级不再进菜单：P 直接沿“无→低→中→高”循环，菜单保持收起。
      event.preventDefault();
      const current = row.querySelector('[data-action="cycle-priority"]')?.dataset.priority ?? 'none';
      const button = row.querySelector('.task__check');
      if (button === null) return;
      button.disabled = true;
      try {
        await onAction?.('cycle-priority', row.dataset.taskId, Number(row.dataset.revision), current);
      } catch (error) {
        onError(error);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
      return;
    }
    const details = row.querySelector('.task__more');
    const firstDate = row.querySelector('[data-menu-section="date"] button');
    if (details === null || firstDate === null) return;
    event.preventDefault();
    details.open = true;
    firstDate.focus();
  };
}

/* 本模块也被 Node 单测引用，DOM 级监听只在浏览器环境注册。 */
if (typeof document !== 'undefined') {
  /* 菜单展开后按视口剩余空间决定方向与高度：
     下方放不下且上方更宽裕时向上翻转，否则把高度限制在视口内、超出部分内部滚动，
     避免靠底或长列表里的菜单被窗口底边截断而够不到下面的动作。 */
  function positionMenu(details) {
    const menu = details.querySelector('.task__menu');
    const summary = details.querySelector('summary');
    if (menu === null || summary === null) return;
    // 先复位到默认（向下、CSS 限高），再重新测量，避免上一次的翻转态影响本次判断。
    menu.classList.remove('task__menu--up');
    menu.style.maxHeight = '';
    const margin = 12;
    const box = summary.getBoundingClientRect();
    const spaceBelow = window.innerHeight - box.bottom - margin;
    const spaceAbove = box.top - margin;
    const contentHeight = menu.scrollHeight;
    const openUp = contentHeight > spaceBelow && spaceAbove > spaceBelow;
    if (openUp) menu.classList.add('task__menu--up');
    const available = openUp ? spaceAbove : spaceBelow;
    menu.style.maxHeight = `${Math.max(120, Math.min(contentHeight, available))}px`;
  }

  /* 动作菜单是临时浮层：点击菜单外任意位置就收起，避免多行菜单同时开着。 */
  document.addEventListener('click', (event) => {
    if (event.target.closest('.task__more') !== null) return;
    for (const details of document.querySelectorAll('.task__more[open]')) {
      details.open = false;
    }
  });

  /* 通过 .open 直接展开时也会触发 toggle 事件，在捕获阶段统一保持 aria-expanded 同步并按视口定位。 */
  document.addEventListener('toggle', (event) => {
    const details = event.target;
    if (details instanceof HTMLElement && details.classList.contains('task__more')) {
      details.querySelector('summary')?.setAttribute('aria-expanded', String(details.open));
      if (details.open) positionMenu(details);
    }
  }, true);
}
