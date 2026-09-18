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

export function getPostponeOptions(today) {
  const date = new Date(`${today}T00:00:00`);
  const weekday = date.getDay();
  const daysUntilNextMonday = ((1 - weekday + 7) % 7) || 7;
  return [
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
  return task.scheduledDate === null ? '收集箱 · 无时间' : `${formatLocalDay(task.scheduledDate)} · 无时间`;
}

function taskStatus(task, today) {
  if (task.trashedAt !== null) return '已删除';
  if (task.lifecycle === 'completed') return '已完成';
  if (task.lifecycle === 'cancelled') return '已取消';
  if (task.scheduledDate !== null && task.scheduledDate < today) return '逾期';
  if (task.lifecycle === 'in_progress') return '进行中';
  return '待办';
}

function postponeMenu(task, today) {
  if (!ACTIVE_LIFECYCLES.has(task.lifecycle) || task.scheduledDate === null) return '';
  const options = getPostponeOptions(today)
    .map((option) => `<button type="button" data-action="postpone" data-date="${option.value}">${option.label} · ${formatLocalDay(option.value)}</button>`)
    .join('');
  return `<div class="task__postpone" role="group" aria-label="延期 ${escapeHtml(task.title)}">
    <span class="task__menu-label">延期到</span>
    ${options}
    <label class="task__custom-date">自定义 <input type="date" min="${today}" data-postpone-date><button type="button" data-action="postpone-custom">确定</button></label>
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
  } else {
    actions.push('<button type="button" data-action="restore">恢复待办</button>');
  }
  actions.push('<button type="button" data-action="copy">复制</button>');
  actions.push('<button type="button" data-action="trash">删除</button>');
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

function taskMarkup(task, today, tags) {
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
  return `<article class="task task--${escapeHtml(task.lifecycle)}${overdue ? ' task--overdue' : ''}" data-task-id="${escapeHtml(task.id)}" data-revision="${task.revision}" role="listitem">
    <button class="task__check" type="button" role="checkbox" aria-checked="${checked}" data-action="${checkboxAction}" aria-label="${canRestore ? '恢复任务' : '完成任务'}">${checked ? '✓' : ''}</button>
    <div class="task__body">
      <button class="task__title" type="button" data-action="edit">${escapeHtml(task.title)}</button>
      <span class="task__meta"><span class="task__status">${status}</span> · ${escapeHtml(taskMeta(task, today))}${task.starred ? ' · 已星标' : ''}${tagMarkup}</span>
    </div>
    <details class="task__more">
      <summary aria-label="更多任务操作">更多</summary>
      <div class="task__menu">
        ${taskActions(task)}
        ${postponeMenu(task, today)}
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
} = {}) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    // 月历格传空字符串表示"这一格不需要占位文案"。此时必须什么都不渲染，
    // 否则空的 <p class="empty"> 会在每个空格子里留下一条悬空横线（.empty 自带下边框）。
    container.innerHTML = emptyMessage === '' ? '' : `<p class="empty">${escapeHtml(emptyMessage)}</p>`;
    container.onclick = null;
    return;
  }

  container.innerHTML = `<div class="task-list" role="list">${tasks.map((task) => taskMarkup(task, today, tags)).join('')}</div>`;
  container.onclick = async (event) => {
    const button = event.target.closest('button[data-action]');
    if (button === null) return;
    const row = button.closest('[data-task-id]');
    if (row === null) return;
    const action = button.dataset.action;
    if (action === 'edit') {
      await onEdit?.(row.dataset.taskId);
      return;
    }

    const value = action === 'postpone-custom'
      ? row.querySelector('[data-postpone-date]')?.value
      : button.dataset.date;
    const resolvedAction = action === 'postpone-custom' ? 'postpone' : action;
    button.disabled = true;
    try {
      await onAction?.(resolvedAction, row.dataset.taskId, Number(row.dataset.revision), value);
    } catch (error) {
      onError(error);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };
}
