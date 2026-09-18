import { formatLocalDay, toLocalDate } from '../domain/dates.js';
import { applyTheme, THEME_SETTINGS } from '../shared/theme.js';
import { TaskRepository } from '../data/task-repository.js';
import { RecurringTemplateRepository } from '../data/recurring-template-repository.js';
import { TagRepository } from '../data/tag-repository.js';
import { SettingsRepository } from '../data/settings-repository.js';
import { TaskService } from '../services/task-service.js';
import { TagService } from '../services/tag-service.js';
import { SubtaskService } from '../services/subtask-service.js';
import { TaskQueryService } from '../services/task-query-service.js';
import { StatisticsService } from '../services/statistics-service.js';
import { SummaryService } from '../services/summary-service.js';
import { BackupService } from '../services/backup-service.js';
import { CsvExportService } from '../services/csv-service.js';
import { DashboardController } from './dashboard-controller.js';
import { UndoController } from './undo-controller.js';
import { createTaskEditor } from './task-editor.js';
import { createTodayView } from './views/today-view.js';
import { createWeekView } from './views/week-view.js';
import { createMonthView } from './views/month-view.js';
import { createInboxView } from './views/inbox-view.js';
import { createAllTasksView } from './views/all-tasks-view.js';
import { createCompletedView } from './views/completed-view.js';
import { createTrashView } from './views/trash-view.js';
import { createHistoryView } from './views/history-view.js';
import { createSettingsView } from './views/settings-view.js';
import { RecurringService } from '../services/recurring-service.js';
import { generateId } from '../shared/ids.js';
import { createShortcutHandler } from './shortcuts.js';
import { createNavBadges } from './nav-badges.js';
import { ResourceRepository } from '../data/resource-repository.js';
import { ResourceService } from '../services/resource-service.js';
import { createResourcePicker } from './resource-picker.js';
import { createResourcesView } from './views/resources-view.js';

const routeMeta = {
  today: ['今日工作', '现在最需要推进的事项'],
  tomorrow: ['明天', '提前看清下一日安排'],
  week: ['本周', '按天查看这一周的计划'],
  month: ['月历', '按月查看计划和任务分布'],
  inbox: ['收集箱', '先记录，再整理'],
  resources: ['资料收集箱', '先保存上下文，再决定归属'],
  all: ['全部任务', '查找、筛选和调整工作'],
  completed: ['已完成', '回看已经结束的任务'],
  trash: ['回收站', '恢复或永久删除已删除任务'],
  history: ['工作记录', '按实际完成日期回顾工作'],
  settings: ['设置', '分类与本地数据管理'],
};

const repository = new TaskRepository();
const settingsRepository = new SettingsRepository();
const taskService = new TaskService(repository);
const subtaskService = new SubtaskService(taskService, repository);
const recurringTemplateRepository = new RecurringTemplateRepository();
const recurringService = new RecurringService({
  taskService,
  taskRepository: repository,
  templateRepository: recurringTemplateRepository,
  subtaskService,
  generateId,
});
const query = new TaskQueryService(repository);
const statistics = new StatisticsService(repository);
const summaryService = new SummaryService({ statistics, query });
const resourceRepository = new ResourceRepository();
const resourceService = new ResourceService(resourceRepository);
const backupService = new BackupService(repository, { settingsRepository, resourceRepository });
const csvService = new CsvExportService();
const tagRepository = new TagRepository();
const tagService = new TagService(tagRepository);
const root = document.querySelector('#view-root');
const toast = document.querySelector('#toast');
const confirmDialog = document.querySelector('#confirm-dialog');
const app = document.querySelector('.app');
let controller;
let toastTimer;
const undoController = new UndoController();

async function getResourceCounts(tasks) {
  return new Map(await Promise.all(tasks.map(async (task) => [task.id, (await resourceService.listTaskIds(task.id)).length])));
}

function dateOffset(date, days) {
  return toLocalDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function formatWorkspaceDate(date) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
    .format(new Date(`${date}T00:00:00`));
}

function showToast(message, { actionLabel = null, onAction = null } = {}) {
  clearTimeout(toastTimer);
  toast.replaceChildren(document.createTextNode(message));
  if (actionLabel !== null && onAction !== null) {
    undoController.offer({ message, undo: onAction });
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = actionLabel;
    button.addEventListener('click', async () => {
      toast.hidden = true;
      try {
        await undoController.undo();
      } catch (error) {
        onError(error);
      }
    }, { once: true });
    toast.append(' ', button);
  } else {
    undoController.dismiss();
  }
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
    undoController.dismiss();
  }, 5000);
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

  if (action === 'delete-permanently') {
    const confirmed = await confirmAction({
      title: '永久删除任务？',
      message: '删除后无法从回收站恢复，任务事件也会一起移除。',
      confirmLabel: '永久删除',
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
    // 日期在界面上只写中文格式，ISO 只留在数据层与导出文件里。
    showToast(value ? `已延期到 ${formatLocalDay(value)}` : '任务已更新');
  } else if (action === 'copy') {
    showToast('已复制为新任务');
  } else if (action === 'delete-permanently') {
    showToast('已永久删除');
  } else if (action === 'untrash') {
    showToast('已恢复任务');
  } else {
    showToast('任务已更新');
  }
  return result;
}

async function onEdit(taskId) {
  const task = await taskService.getTask(taskId);
  await taskEditor.openTask(task, document.activeElement);
}

const viewOptions = {
  root,
  query,
  taskService,
  recurringService,
  tagService,
  statistics,
  summaryService,
  today: () => toLocalDate(new Date()),
  onAction,
  onEdit,
  onError,
  resourceService,
  getResourceCounts,
};
const views = {
  today: createTodayView(viewOptions),
  tomorrow: createWeekView({ ...viewOptions, singleDate: true }),
  week: createWeekView(viewOptions),
  month: createMonthView(viewOptions),
  inbox: createInboxView(viewOptions),
  resources: createResourcesView({ ...viewOptions, resourceService }),
  all: createAllTasksView(viewOptions),
  completed: createCompletedView(viewOptions),
  trash: createTrashView(viewOptions),
  history: createHistoryView(viewOptions),
  settings: createSettingsView({
    root,
    taskService,
    tagService,
    query,
    csvService,
    settingsRepository,
    backupService,
    onDataChanged: () => controller.refresh(),
    onError,
  }),
};
const navBadges = createNavBadges({
  container: document.querySelector('.sidebar'),
  query,
  today: () => toLocalDate(new Date()),
});
controller = new DashboardController({
  views,
  taskService,
  subtaskService,
  recurringService,
  sendMessage: (message) => chrome.runtime.sendMessage(message),
  onRendered: () => navBadges.refresh(),
});

const resourcePicker = createResourcePicker({
  dialog: document.querySelector('#resource-dialog'),
  resourceService,
  onChanged: () => controller.refresh(),
  onError,
});

const taskEditor = createTaskEditor({
  dialog: document.querySelector('#task-editor'),
  getCategories: () => taskService.listCategories(),
  getTags: () => tagService.list(),
  onCreateTag: (name) => tagService.create(name),
  subtaskService,
  onCreate: (input) => controller.createTask(input),
  onUpdate: (taskId, changes, revision) => controller.editTask(taskId, changes, revision),
  onCreateRecurring: (input) => recurringService.createTemplate(input).then(async (result) => {
    await chrome.runtime.sendMessage({ type: 'TASK_CHANGED', taskId: result.task.id });
    await controller.refresh();
    return result;
  }),
  onCopy: (taskId) => controller.handleTaskAction('copy', taskId),
  onReload: (taskId) => taskService.getTask(taskId),
  resourceService,
  openResourcePicker: (taskId, source) => resourcePicker.openForTask(taskId, source),
});

async function navigate(route) {
  const nextRoute = routeMeta[route] === undefined ? 'today' : route;
  const [title, subtitle] = routeMeta[nextRoute];
  document.querySelector('#page-title').textContent = title;
  document.querySelector('#page-subtitle').textContent = subtitle;
  document.querySelector('#quick-add').hidden = ['history', 'settings', 'resources'].includes(nextRoute);
  document.querySelector('#quick-add-message').textContent = '';
  await controller.navigate(nextRoute);
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
    showToast(scheduledDate === null ? '已添加到收集箱' : `已安排到 ${formatLocalDay(scheduledDate)}`, {
      actionLabel: '撤销',
      onAction: () => controller.handleTaskAction('trash', result.task.id, result.task.revision).catch(onError),
    });
    input.focus();
  } catch (error) {
    message.textContent = error?.message || '任务没有保存。你的输入还在，请重试。';
    input.focus();
  }
});

document.addEventListener('keydown', createShortcutHandler({
  navigate,
  isBlocked: () => Boolean(document.querySelector('dialog[open]')),
  focusQuickAdd: () => {
    if (document.querySelector('#quick-add')?.hidden) return;
    document.querySelector('#quick-add-title')?.focus();
  },
  focusSearch: () => document.querySelector('input[type="search"]')?.focus(),
}));

chrome.runtime.onMessage.addListener((message) => {
  controller.onMessage(message).catch(onError);
});

document.querySelector('#workspace-date').textContent = formatWorkspaceDate(toLocalDate(new Date()));

async function initialize() {
  let settings;
  try {
    settings = await settingsRepository.getSettings();
  } catch (error) {
    onError(error);
  }
  try {
    const theme = THEME_SETTINGS.includes(settings?.theme) ? settings.theme : 'system';
    applyTheme(theme);
  } finally {
    app.hidden = false;
  }
  await navigate('today').catch(onError);
}

initialize().catch(onError);
