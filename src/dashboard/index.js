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
import { readRoute, writeRoute, DEFAULT_ROUTE } from './hash.js';
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
  settings: ['设置', '列表与本地数据管理'],
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
const backupService = new BackupService(repository, {
  settingsRepository,
  resourceRepository,
  appVersion: chrome.runtime.getManifest().version,
});
const csvService = new CsvExportService();
const tagRepository = new TagRepository();
const tagService = new TagService(tagRepository);
const root = document.querySelector('#view-root');
const toast = document.querySelector('#toast');
const confirmDialog = document.querySelector('#confirm-dialog');
const app = document.querySelector('.app');
// 月历“+N 更多”的当日任务弹窗：放在视图之外，月份切换或列表重渲染都不会丢掉它。
const dayDialog = document.querySelector('#month-day-dialog');
let controller;
let toastTimer;
const undoController = new UndoController();
// 移出可见列表且无确认框的动作（移入回收站、取消）用的加长撤销窗口：
// 行一旦离开视线就没有二次机会，5 秒不够把手放回鼠标。
const TRASH_UNDO_WINDOW = 10000;

async function getResourceCounts(tasks) {
  return new Map(await Promise.all(tasks.map(async (task) => [task.id, (await resourceService.listTaskIds(task.id)).length])));
}

function dateOffset(date, days) {
  return toLocalDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function formatWorkspaceDate(date) {
  // 头部日期只表达“今天是哪天”，与视图内表达“当前查看月份/周”的标题区分开，
  // 避免同屏出现两个都像“当前时间”的日期而互相打架。
  const formatted = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
    .format(new Date(`${date}T00:00:00`));
  return `今天 · ${formatted}`;
}

function showToast(message, { actionLabel = null, onAction = null, duration = 5000 } = {}) {
  clearTimeout(toastTimer);
  toast.replaceChildren(document.createTextNode(message));
  if (actionLabel !== null && onAction !== null) {
    undoController.offer({ message, undo: onAction }, duration);
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
  }, duration);
}

function confirmAction({ title, message, confirmLabel = null }) {
  const trigger = document.activeElement;
  confirmDialog.querySelector('[data-confirm-title]').textContent = title;
  confirmDialog.querySelector('[data-confirm-message]').textContent = message;
  // 兜底也用动作名称：界面上不出现单独的"确认"。
  confirmDialog.querySelector('[data-confirm-submit]').textContent = confirmLabel ?? title.replace(/[？?]$/, '');
  confirmDialog.showModal();
  confirmDialog.querySelector('button[value="cancel"]')?.focus();
  return new Promise((resolve) => {
    confirmDialog.addEventListener('close', () => {
      trigger?.focus?.();
      resolve(confirmDialog.returnValue === 'confirm');
    }, { once: true });
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
  if (action === 'undo-create') {
    const result = await controller.handleTaskAction('undo-create', taskId, revision);
    showToast('已撤销创建');
    return result;
  }

  if (action === 'complete') {
    const count = await subtaskService.activeCount(taskId);
    let force = false;
    if (count > 0) {
      force = await confirmAction({
        title: '完成父任务及其子任务？',
        message: `还有 ${count} 个子任务未完成。完成父任务会同时把这些子任务标记为已完成。`,
        confirmLabel: '完成全部',
      });
      if (!force) return null;
    }
    const result = await controller.handleTaskAction('complete', taskId, revision, { force });
    const children = result.completedChildren ?? [];
    showToast(children.length > 0 ? `已完成父任务和 ${children.length} 个子任务` : '已完成任务', {
      actionLabel: '撤销',
      onAction: async () => {
        try {
          if (result.nextTaskCreated && result.nextTask !== null) {
            await controller.handleTaskAction('undo-create', result.nextTask.id, result.nextTask.revision);
          }
          await controller.handleTaskAction('restore', taskId, result.task.revision);
          for (const child of children) {
            await controller.handleTaskAction('restore', child.id, child.revision);
          }
          showToast(children.length > 0 ? '已撤销完成' : '已恢复为待办');
        } catch (error) {
          onError(error);
        }
      },
    });
    return result;
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
      duration: TRASH_UNDO_WINDOW,
      onAction: async () => {
        try {
          await controller.handleTaskAction('restore', taskId, result.task.revision);
          showToast('已恢复为待办');
        } catch (error) {
          onError(error);
        }
      },
    });
  } else if (action === 'trash') {
    // 移入回收站不再叠加确认框：它本来就可撤销，确认 + 撤销是双摩擦。
    // 代价是误触即走，所以把撤销窗口加长，并把它写进 Toast 文案。
    showToast('已移入回收站，10 秒内可撤销', {
      actionLabel: '撤销',
      duration: TRASH_UNDO_WINDOW,
      onAction: async () => {
        try {
          await controller.handleTaskAction('untrash', taskId, result.task.revision);
          showToast('已恢复任务');
        } catch (error) {
          onError(error);
        }
      },
    });
  } else if (action === 'cycle-priority') {
    // P 键循环优先级：菜单里没有对应按钮，Toast 是唯一的结果反馈，必须报出新档位。
    const labels = { none: '无优先级', low: '低优先级', medium: '中优先级', high: '高优先级' };
    showToast(`已设为${labels[result.task.priority] ?? '无优先级'}`);
  } else if (action === 'set-starred') {
    // 开关类动作必须报出新状态，否则用户只能重开菜单确认；与 P 键同等处理。
    showToast(result.task.starred ? '已加星标' : '已取消星标');
  } else if (action === 'postpone') {
    // 日期在界面上只写中文格式，ISO 只留在数据层与导出文件里。
    showToast(value ? `已延期到 ${formatLocalDay(value)}` : '任务已更新');
  } else if (action === 'reschedule') {
    showToast(value ? `已安排到 ${formatLocalDay(value)}` : '已移除计划日期');
  } else if (action === 'copy') {
    showToast('已复制为新任务');
  } else if (action === 'delete-permanently') {
    showToast('已永久删除');
  } else if (action === 'untrash') {
    showToast('已恢复任务');
  } else if (action === 'restore') {
    showToast('已恢复为待办');
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
  confirmAction,
  resourceService,
  getResourceCounts,
};
const views = {
  today: createTodayView(viewOptions),
  tomorrow: createWeekView({ ...viewOptions, singleDate: true }),
  week: createWeekView(viewOptions),
  month: createMonthView({ ...viewOptions, dayDialog }),
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
  onCopy: (taskId, changes) => controller.handleTaskAction('copy', taskId, undefined, changes),
  onReload: (taskId) => taskService.getTask(taskId),
  resourceService,
  openResourcePicker: (taskId, source) => resourcePicker.openForTask(taskId, source),
  onClose: () => controller.refresh(),
  onError,
  confirmDiscard: () => confirmAction({
    title: '放弃未保存的修改？',
    message: '关闭后这次修改不会保存，任务仍保持打开前的状态。',
    confirmLabel: '放弃修改',
  }),
});

/* 侧栏高亮必须跟着"最终渲染的那个路由"走，所以放在 navigate 里，
   而不是只挂在鼠标点击上——按 T/W/M 走的是同一条 navigate。 */
function markCurrentRoute(route) {
  document.querySelectorAll('[data-route]').forEach((item) => {
    if (item.dataset.route === route) {
      // 值必须是 page：aria-current="" 会被当成默认值 false，
      // 既丢语义，也会让 [aria-current="page"] 的选中样式失效。
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });
}

async function navigate(route) {
  const nextRoute = routeMeta[route] === undefined ? 'today' : route;
  // hash 是路由的唯一来源：进入某视图时把路径写回地址栏（replaceState 不触发
  // hashchange，不会与下方监听互相回环），刷新、深链、收藏都能停在当前视图。
  lastRoutePath = nextRoute;
  writeRoute(nextRoute);
  const [title, subtitle] = routeMeta[nextRoute];
  document.querySelector('#page-title').textContent = title;
  document.querySelector('#page-subtitle').textContent = subtitle;
  document.querySelector('#quick-add').hidden = ['history', 'settings', 'resources'].includes(nextRoute);
  document.querySelector('#quick-add-message').textContent = '';
  markCurrentRoute(nextRoute);
  await controller.navigate(nextRoute);
}

// 地址栏 hash 变化（前进/后退/手动改路径）时复用同一条 navigate；
// 视图级查询参数（筛选、记录范围）由视图自身响应，这里只在路径变化时重路由，
// 避免改一个筛选条件写回 hash 时又触发整页重渲染。
let lastRoutePath = readRoute();
window.addEventListener('hashchange', () => {
  const path = readRoute() || DEFAULT_ROUTE;
  if (path === lastRoutePath) return;
  void navigate(path).catch(onError);
});

document.querySelectorAll('[data-route]').forEach((button) => {
  button.addEventListener('click', () => {
    void navigate(button.dataset.route).catch(onError);
  });
});

dayDialog.querySelectorAll('[data-day-dialog-close]').forEach((button) => {
  button.addEventListener('click', () => dayDialog.close());
});

document.querySelector('#quick-add-date').addEventListener('change', (event) => {
  document.querySelector('#quick-add-custom').hidden = event.target.value !== 'custom';
});

document.querySelector('#quick-add-more').addEventListener('click', () => {
  void (async () => {
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
  })().catch(onError);
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
    // 保留本次日期选择：连续安排多件“今天”的任务时不必每件重选；
    // 自定义日期仍然清空，避免下一个标题悄悄落到旧日期上。
    custom.value = '';
    if (select.value === 'custom') custom.hidden = true;
    showToast(scheduledDate === null ? '已添加到收集箱' : `已安排到 ${formatLocalDay(scheduledDate)}`, {
      actionLabel: '撤销',
      onAction: () => onAction('undo-create', result.task.id, result.task.revision).catch(onError),
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
  await navigate(readRoute() || DEFAULT_ROUTE).catch(onError);
}

initialize().catch(onError);
