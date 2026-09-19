import { formatLocalDay, toLocalDate } from '../domain/dates.js';
import { escapeHtml } from '../shared/ui.js';

const ACTIVE_LIFECYCLES = new Set(['todo', 'in_progress']);

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

function scheduleMenu(task, today) {
  if (!ACTIVE_LIFECYCLES.has(task.lifecycle)) return '';
  const options = getScheduleOptions(today)
    .map((option) => `<button type="button" data-action="reschedule" data-date="${option.value}">${option.label} · ${formatLocalDay(option.value)}</button>`)
    .join('');
  return `<div class="task__postpone" data-menu-section="date" role="group" aria-label="安排 ${escapeHtml(task.title)}">
    <span class="task__menu-label">日期</span>
    ${options}
    <label class="task__custom-date">自定义 <input type="date" data-schedule-date><button type="button" data-action="reschedule-custom">确定</button></label>
    <button type="button" data-action="reschedule" data-date="">移除计划日期</button>
  </div>`;
}

function priorityMenu(task) {
  if (!ACTIVE_LIFECYCLES.has(task.lifecycle)) return '';
  const priorities = [
    ['none', '无优先级'],
    ['low', '低优先级'],
    ['medium', '中优先级'],
    ['high', '高优先级'],
  ];
  return `<div class="task__postpone" data-menu-section="priority" role="group" aria-label="优先级 ${escapeHtml(task.title)}">
    <span class="task__menu-label">优先级</span>
    ${priorities.map(([value, label]) => `<button type="button" data-action="set-priority" data-priority="${value}" aria-pressed="${task.priority === value}">${label}</button>`).join('')}
  </div>`;
}

function taskActions(task) {
  const actions = [];
  if (task.trashedAt !== null) {
    actions.push('<button type="button" data-action="untrash">恢复</button>');
    actions.push('<button type="button" data-action="delete-permanently">永久删除</button>');
    return actions.join('');
  }
  if (task.lifecycle === 'todo') actions.push('<button type="button" data-action="start">开始</button>');
  if (ACTIVE_LIFECYCLES.has(task.lifecycle)) {
    actions.push('<button type="button" data-action="complete">完成</button>');
    actions.push('<button type="button" data-action="cancel">取消</button>');
    actions.push(`<button type="button" data-action="set-starred" data-starred="${task.starred ? 'false' : 'true'}">${task.starred ? '取消星标' : '加星标'}</button>`);
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

function taskMarkup(task, today, tags, resourceCounts) {
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
  const priorityLabel = taskPriorityLabel(task.priority);
  const priorityMarkup = ` · <span class="task__priority">${priorityLabel}</span>`;
  // 恢复不是勾选行为：可恢复的行用普通按钮，避免读屏把动作读成复选框的状态切换。
  const checkAttributes = canRestore
    ? 'aria-label="恢复任务"'
    : `role="checkbox" aria-checked="${checked}" aria-label="完成任务"`;
  return `<article class="task task--${escapeHtml(task.lifecycle)}${overdue ? ' task--overdue' : ''}" data-task-id="${escapeHtml(task.id)}" data-revision="${task.revision}" role="listitem">
    <button class="task__check" type="button" ${checkAttributes} data-action="${checkboxAction}">${checked ? '✓' : ''}</button>
    <div class="task__body">
      <button class="task__title" type="button" data-action="edit" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</button>
      <span class="task__meta"><span class="task__status">${status}</span> · ${escapeHtml(taskMeta(task, today))}${priorityMarkup}${task.starred ? ' · 已星标' : ''}${tagMarkup}${resourceLabel}</span>
    </div>
    <details class="task__more">
      <summary aria-label="更多任务操作">更多</summary>
      <div class="task__menu">
        ${taskActions(task)}
        ${scheduleMenu(task, today)}
        ${priorityMenu(task)}
      </div>
    </details>
  </article>`;
}

export function renderTaskList(container, tasks, {
  today,
  onAction,
  onEdit,
  onError = () => {},
  emptyMessage = '这里暂时没有任务。',
  tags = [],
  resourceCounts = new Map(),
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
    container.innerHTML = `<div class="task-list" role="list">${visibleTasks.map((task) => taskMarkup(task, today, tags, resourceCounts)).join('')}</div>${more}`;
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
    if (button === null) return;
    const row = button.closest('[data-task-id]');
    if (row === null) return;
    const action = button.dataset.action;
    if (action === 'edit') {
      await onEdit?.(row.dataset.taskId);
      return;
    }

    const value = action === 'reschedule-custom'
      ? row.querySelector('[data-schedule-date]')?.value
      : action === 'set-priority'
        ? button.dataset.priority
        : action === 'set-starred'
          ? button.dataset.starred === 'true'
        : button.dataset.date === '' ? null : button.dataset.date;
    const resolvedAction = action === 'reschedule-custom' ? 'reschedule' : action;
    button.disabled = true;
    try {
      await onAction?.(resolvedAction, row.dataset.taskId, Number(row.dataset.revision), value);
    } catch (error) {
      onError(error);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };
  container.onkeydown = (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['d', 'p'].includes(event.key.toLowerCase())) return;
    if (event.target.closest('input, select, textarea')) return;
    const row = event.target.closest('[data-task-id]');
    if (row === null) return;
    const details = row.querySelector('.task__more');
    const section = row.querySelector(`[data-menu-section="${event.key.toLowerCase() === 'd' ? 'date' : 'priority'}"]`);
    const firstAction = section?.querySelector('button');
    if (details === null || firstAction === null) return;
    event.preventDefault();
    details.open = true;
    firstAction.focus();
  };
}
