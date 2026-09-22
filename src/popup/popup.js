import { toLocalDate } from '../domain/dates.js';
import { TaskRepository } from '../data/task-repository.js';
import { TaskService } from '../services/task-service.js';
import { SubtaskService } from '../services/subtask-service.js';
import { RecurringTemplateRepository } from '../data/recurring-template-repository.js';
import { RecurringService } from '../services/recurring-service.js';
import { TaskQueryService } from '../services/task-query-service.js';
import { StatisticsService } from '../services/statistics-service.js';
import { generateId } from '../shared/ids.js';
import { escapeHtml } from '../shared/ui.js';
import { getQuickAddFeedback } from '../shared/ux.js';
import { PopupController } from './popup-controller.js';

function dateOffset(date, days) {
  return toLocalDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function formatDate(date) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
    .format(new Date(`${date}T00:00:00`));
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/index.html') });
}

function showPopupSuccess(feedback, onUndo) {
  toast.replaceChildren();
  const text = document.createElement('span');
  text.textContent = feedback.message;
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'toast__action';
  undo.textContent = feedback.undoAction;
  undo.addEventListener('click', async () => {
    undo.disabled = true;
    try {
      await onUndo();
      text.textContent = '已撤销创建';
      undo.remove();
    } catch {
      text.textContent = '撤销没有完成，请打开工作台处理';
      undo.disabled = false;
    }
  }, { once: true });
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'toast__action';
  action.textContent = feedback.nextAction;
  action.addEventListener('click', openDashboard, { once: true });
  toast.append(text, ' ', undo, ' ', action);
  toast.hidden = false;
  window.clearTimeout(showPopupSuccess.timeoutId);
  showPopupSuccess.timeoutId = window.setTimeout(() => { toast.hidden = true; }, 5000);
}

function showCompleteToast(undoLabel, onUndo) {
  toast.replaceChildren();
  const text = document.createElement('span');
  text.textContent = undoLabel;
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'toast__action';
  undo.textContent = '撤销';
  undo.addEventListener('click', async () => {
    undo.disabled = true;
    try {
      await onUndo();
      text.textContent = '已撤销完成';
      undo.remove();
    } catch {
      text.textContent = '撤销没有完成，请打开工作台处理';
      undo.disabled = false;
    }
  }, { once: true });
  toast.append(text, ' ', undo);
  toast.hidden = false;
  window.clearTimeout(showPopupSuccess.timeoutId);
  showPopupSuccess.timeoutId = window.setTimeout(() => { toast.hidden = true; }, 5000);
}

function taskMarkup(task, today) {
  const overdue = task.scheduledDate !== null && task.scheduledDate < today;
  const detail = overdue ? '逾期' : (task.startTime ?? '无时间');
  const checked = task.lifecycle === 'completed';
  // 完成是 Popup 里的“立刻推进”动作：用真正的按钮与 role="checkbox"，
  // 与工作台任务行的圆圈完全一致的语义，而不是看起来能点却不可点的静态符号。
  return `<li class="task-row"><button class="task-row__check" type="button" role="checkbox" aria-checked="${checked}" aria-label="完成任务：${escapeHtml(task.title)}" data-action="complete" data-task-id="${escapeHtml(task.id)}" data-revision="${task.revision}">${checked ? '✓' : ''}</button><span class="task-row__title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span><span class="task-row__detail${overdue ? ' task-row__detail--overdue' : ''}">${detail}</span></li>`;
}

const repository = new TaskRepository();
const popupTaskService = new TaskService(repository);
const popupSubtaskService = new SubtaskService(popupTaskService, repository);
const popupRecurringService = new RecurringService({
  taskService: popupTaskService,
  taskRepository: repository,
  templateRepository: new RecurringTemplateRepository(),
  subtaskService: popupSubtaskService,
  generateId,
});
const controller = new PopupController({
  taskService: popupTaskService,
  subtaskService: popupSubtaskService,
  recurringService: popupRecurringService,
  queryService: new TaskQueryService(repository),
  statisticsService: new StatisticsService(repository),
  today: () => toLocalDate(new Date()),
  sendMessage: (message) => chrome.runtime.sendMessage(message),
});
const form = document.querySelector('#quick-create-form');
const input = document.querySelector('#quick-title');
const message = document.querySelector('#form-message');
const toast = document.querySelector('#toast');
const dateButtons = [...document.querySelectorAll('[data-date]')];
let selectedDate = 'inbox';

function setSelectedDate(value) {
  selectedDate = value;
  dateButtons.forEach((button) => { button.setAttribute('aria-pressed', String(button.dataset.date === value)); });
}

function renderTasks(state) {
  // 逾期与今日两节分别取自 load 的各自配额，逾期不再挤空今日列表。
  const overdueSection = document.querySelector('#overdue-section');
  overdueSection.hidden = state.overdueCount === 0;
  const hiddenOverdueCount = Math.max(state.overdueCount - state.overdueTasks.length, 0);
  document.querySelector('#overdue-heading').textContent = hiddenOverdueCount > 0
    ? `逾期 ${state.overdueCount}（还有 ${hiddenOverdueCount} 项，打开工作台查看）`
    : `逾期 ${state.overdueCount}`;
  document.querySelector('#overdue-list').innerHTML = state.overdueTasks.map((task) => taskMarkup(task, state.date)).join('');
  document.querySelector('#focus-list').innerHTML = state.focusTasks.map((task) => taskMarkup(task, state.date)).join('');
  document.querySelector('#empty-state').hidden = state.overdueTasks.length + state.focusTasks.length !== 0;
}

async function refresh() {
  const state = await controller.load();
  document.querySelector('#today-label').textContent = `今日 · ${formatDate(state.date)}`;
  const { completedCount, plannedCount, completionRate } = state.summary;
  document.querySelector('#summary-text').textContent = `完成 ${completedCount} / ${plannedCount} · 还剩 ${Math.max(plannedCount - completedCount, 0)} 项`;
  document.querySelector('#progress-bar').style.width = `${Math.round((completionRate ?? 0) * 100)}%`;
  renderTasks(state);
}

dateButtons.forEach((button) => button.addEventListener('click', () => setSelectedDate(button.dataset.date)));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  const today = toLocalDate(new Date());
  const scheduledDate = selectedDate === 'today' ? today : selectedDate === 'tomorrow' ? dateOffset(new Date(), 1) : null;
  try {
    const task = await controller.quickCreate(input.value, scheduledDate);
    input.value = '';
    setSelectedDate('inbox');
    showPopupSuccess(getQuickAddFeedback({ scheduledDate }), async () => {
      await controller.undoCreate(task);
      await refresh();
    });
    await refresh();
    input.focus();
  } catch {
    message.textContent = '任务没有保存。你的输入还在，请检查标题后重试。';
    input.focus();
  }
});

document.querySelector('#open-dashboard').addEventListener('click', openDashboard);

async function handleComplete(button) {
  const taskId = button.dataset.taskId;
  const revision = Number(button.dataset.revision);
  button.disabled = true;
  try {
    const { task: completed, completedChildren, nextTask, nextTaskCreated } = await controller.completeTask(taskId, revision);
    await refresh();
    // 级联结果写进反馈：与工作台同一口径，用户才能预判撤销覆盖的范围。
    showCompleteToast(
      completedChildren.length > 0 ? `已完成父任务和 ${completedChildren.length} 个子任务` : '已完成任务',
      async () => {
        if (nextTaskCreated && nextTask !== null) await controller.undoCreate(nextTask);
        await controller.restoreTask(taskId, completed.revision);
        await controller.restoreTasks(completedChildren);
        await refresh();
      },
    );
  } catch {
    if (button.isConnected) button.disabled = false;
    message.textContent = '操作没有完成，请重新打开扩展重试。';
  }
}

for (const list of [document.querySelector('#overdue-list'), document.querySelector('#focus-list')]) {
  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="complete"]');
    if (button !== null) void handleComplete(button);
  });
}

input.focus();
refresh().catch(() => { message.textContent = '任务列表暂时无法加载。请重新打开扩展。'; });

chrome.runtime.onMessage.addListener((runtimeMessage) => {
  if (runtimeMessage?.type === 'TASK_CHANGED') {
    refresh().catch(() => { message.textContent = '任务列表暂时无法加载。请重新打开扩展。'; });
  }
});
