import { toLocalDate } from '../domain/dates.js';
import { TaskRepository } from '../data/task-repository.js';
import { TagRepository } from '../data/tag-repository.js';
import { SettingsRepository } from '../data/settings-repository.js';
import { TaskService } from '../services/task-service.js';
import { TagService } from '../services/tag-service.js';
import { SubtaskService } from '../services/subtask-service.js';
import { TaskQueryService } from '../services/task-query-service.js';
import { StatisticsService } from '../services/statistics-service.js';
import { BackupService } from '../services/backup-service.js';
import { DashboardController } from './dashboard-controller.js';
import { createTaskEditor } from './task-editor.js';
import { createTodayView } from './views/today-view.js';
import { createInboxView } from './views/inbox-view.js';
import { createAllTasksView } from './views/all-tasks-view.js';
import { createCompletedView } from './views/completed-view.js';
import { createHistoryView } from './views/history-view.js';
import { createSettingsView } from './views/settings-view.js';

const routeMeta = {
  today: ['今日工作', '现在最需要推进的事项'],
  inbox: ['收集箱', '先记录，再整理'],
  all: ['全部任务', '查找、筛选和调整工作'],
  completed: ['已完成', '回看已经结束的任务'],
  history: ['工作记录', '按实际完成日期回顾工作'],
  settings: ['设置', '分类与本地数据管理'],
};

const repository = new TaskRepository();
const settingsRepository = new SettingsRepository();
const taskService = new TaskService(repository);
const subtaskService = new SubtaskService(taskService, repository);
const query = new TaskQueryService(repository);
const statistics = new StatisticsService(repository);
const backupService = new BackupService(repository, { settingsRepository });
const tagRepository = new TagRepository();
const tagService = new TagService(tagRepository);
const root = document.querySelector('#view-root');
const toast = document.querySelector('#toast');
const confirmDialog = document.querySelector('#confirm-dialog');
let controller;
let toastTimer;

function dateOffset(date, days) {
  return toLocalDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function formatWorkspaceDate(date) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
    .format(new Date(`${date}T00:00:00`));
}

function showToast(message, { actionLabel = null, onAction = null } = {}) {
  toast.replaceChildren(document.createTextNode(message));
  if (actionLabel !== null && onAction !== null) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = actionLabel;
    button.addEventListener('click', async () => {
      toast.hidden = true;
      await onAction();
    }, { once: true });
    toast.append(' ', button);
  }
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

function confirmAction({ title, message, confirmLabel = '确认' }) {
  confirmDialog.querySelector('[data-confirm-title]').textContent = title;
  confirmDialog.querySelector('[data-confirm-message]').textContent = message;
  confirmDialog.querySelector('[data-confirm-submit]').textContent = confirmLabel;
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true });
  });
}

async function onError(error) {
  if (error?.name === 'ConflictError') {
    showToast('这个任务刚刚在其他窗口更新过，已刷新为最新版本。');
    await controller.refresh();
    return;
  }
  showToast(error?.message || '操作没有完成，请重试。');
}

async function onAction(action, taskId, revision, value) {
  if (action === 'complete') {
    const count = await subtaskService.activeCount(taskId);
    let force = false;
    if (count > 0) {
      force = await confirmAction({
        title: '仍有未完成子任务',
        message: `还有 ${count} 个子任务未完成。确认只会完成父任务，不会自动完成这些子任务。`,
        confirmLabel: '仍然完成',
      });
      if (!force) return null;
    }
    const result = await controller.handleTaskAction('complete', taskId, revision, { force });
    showToast('已完成任务', {
      actionLabel: '撤销',
      onAction: () => controller.handleTaskAction('restore', taskId, result.task.revision).catch(onError),
    });
    return result;
  }

  if (action === 'trash') {
    const confirmed = await confirmAction({
      title: '移入回收站？',
      message: '任务会从当前列表移除，但历史字段会保留。你可以在五秒内撤销。',
      confirmLabel: '移入回收站',
    });
    if (!confirmed) return null;
  }

  const result = await controller.handleTaskAction(action, taskId, revision, value);
  if (action === 'cancel') {
    showToast('已取消任务', {
      actionLabel: '撤销',
      onAction: () => controller.handleTaskAction('restore', taskId, result.task.revision).catch(onError),
    });
  } else if (action === 'trash') {
    showToast('已移入回收站', {
      actionLabel: '撤销',
      onAction: () => controller.handleTaskAction('untrash', taskId, result.task.revision).catch(onError),
    });
  } else if (action === 'postpone') {
    showToast(`已延期到 ${value}`);
  } else if (action === 'copy') {
    showToast('已复制为新任务');
  } else {
    showToast('任务已更新');
  }
  return result;
}

async function onEdit(taskId) {
  const task = await taskService.getTask(taskId);
  await taskEditor.openTask(task, document.activeElement);
}

const viewOptions = { root, query, taskService, tagService, statistics, today: () => toLocalDate(new Date()), onAction, onEdit, onError };
const views = {
  today: createTodayView(viewOptions),
  inbox: createInboxView(viewOptions),
  all: createAllTasksView(viewOptions),
  completed: createCompletedView(viewOptions),
  history: createHistoryView(viewOptions),
  settings: createSettingsView({
    root,
    taskService,
    settingsRepository,
    backupService,
    onDataChanged: () => controller.refresh(),
  }),
};
controller = new DashboardController({
  views,
  taskService,
  subtaskService,
  sendMessage: (message) => chrome.runtime.sendMessage(message),
});

const taskEditor = createTaskEditor({
  dialog: document.querySelector('#task-editor'),
  getCategories: () => taskService.listCategories(),
  getTags: () => tagService.list(),
  onCreateTag: (name) => tagService.create(name),
  subtaskService,
  onCreate: (input) => controller.createTask(input),
  onUpdate: (taskId, changes, revision) => controller.editTask(taskId, changes, revision),
  onCopy: (taskId) => controller.handleTaskAction('copy', taskId),
  onReload: (taskId) => taskService.getTask(taskId),
});

async function navigate(route) {
  const [title, subtitle] = routeMeta[route] ?? routeMeta.today;
  document.querySelector('#page-title').textContent = title;
  document.querySelector('#page-subtitle').textContent = subtitle;
  document.querySelector('#quick-add').hidden = ['history', 'settings'].includes(route);
  document.querySelector('#quick-add-message').textContent = '';
  await controller.navigate(route);
}

document.querySelectorAll('[data-route]').forEach((button) => {
  button.addEventListener('click', async () => {
    document.querySelectorAll('[data-route]').forEach((item) => item.removeAttribute('aria-current'));
    button.setAttribute('aria-current', 'page');
    await navigate(button.dataset.route);
  });
});

document.querySelector('#quick-add-date').addEventListener('change', (event) => {
  document.querySelector('#quick-add-custom').hidden = event.target.value !== 'custom';
});

document.querySelector('#quick-add-more').addEventListener('click', async () => {
  const select = document.querySelector('#quick-add-date');
  const custom = document.querySelector('#quick-add-custom');
  const now = new Date();
  const scheduledDate = select.value === 'today'
    ? toLocalDate(now)
    : select.value === 'tomorrow'
      ? dateOffset(now, 1)
      : select.value === 'custom'
        ? custom.value || null
        : null;
  await taskEditor.openNew({
    title: document.querySelector('#quick-add-title').value,
    scheduledDate,
  });
});

document.querySelector('#quick-add').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#quick-add-title');
  const select = document.querySelector('#quick-add-date');
  const custom = document.querySelector('#quick-add-custom');
  const message = document.querySelector('#quick-add-message');
  message.textContent = '';
  const now = new Date();
  let scheduledDate = null;
  if (select.value === 'today') scheduledDate = toLocalDate(now);
  if (select.value === 'tomorrow') scheduledDate = dateOffset(now, 1);
  if (select.value === 'custom') {
    scheduledDate = custom.value;
    if (scheduledDate.length === 0) {
      message.textContent = '请选择任务计划日期。';
      custom.focus();
      return;
    }
  }
  try {
    const result = await controller.createTask({ title: input.value, scheduledDate });
    input.value = '';
    custom.value = '';
    select.value = 'inbox';
    custom.hidden = true;
    showToast(scheduledDate === null ? '已添加到收集箱' : `已安排到 ${scheduledDate}`, {
      actionLabel: '撤销',
      onAction: () => controller.handleTaskAction('trash', result.task.id, result.task.revision).catch(onError),
    });
    input.focus();
  } catch (error) {
    message.textContent = error?.message || '任务没有保存。你的输入还在，请重试。';
    input.focus();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  controller.onMessage(message).catch(onError);
});

document.querySelector('#workspace-date').textContent = formatWorkspaceDate(toLocalDate(new Date()));
navigate('today').catch(onError);
