import { toLocalDate } from '../domain/dates.js';
import { TaskRepository } from '../data/task-repository.js';
import { TaskService } from '../services/task-service.js';
import { TaskQueryService } from '../services/task-query-service.js';
import { StatisticsService } from '../services/statistics-service.js';
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

function showPopupSuccess(feedback) {
  toast.replaceChildren();
  const text = document.createElement('span');
  text.textContent = feedback.message;
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'toast__action';
  action.textContent = feedback.nextAction;
  action.addEventListener('click', openDashboard, { once: true });
  toast.append(text, action);
  toast.hidden = false;
  window.clearTimeout(showPopupSuccess.timeoutId);
  showPopupSuccess.timeoutId = window.setTimeout(() => { toast.hidden = true; }, 5000);
}

function taskMarkup(task, today) {
  const overdue = task.scheduledDate !== null && task.scheduledDate < today;
  const detail = overdue ? '逾期' : (task.startTime ?? '无时间');
  return `<li class="task-row"><span class="task-row__state" aria-label="待办">□</span><span class="task-row__title">${escapeHtml(task.title)}</span><span class="task-row__detail${overdue ? ' task-row__detail--overdue' : ''}">${detail}</span></li>`;
}

const repository = new TaskRepository();
const controller = new PopupController({
  taskService: new TaskService(repository),
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
  const overdueTasks = state.focusTasks.filter((task) => task.scheduledDate !== null && task.scheduledDate < state.date);
  const otherTasks = state.focusTasks.filter((task) => !overdueTasks.includes(task));
  const overdueSection = document.querySelector('#overdue-section');
  overdueSection.hidden = state.overdueCount === 0;
  document.querySelector('#overdue-heading').textContent = `逾期 ${state.overdueCount}`;
  document.querySelector('#overdue-list').innerHTML = overdueTasks.map((task) => taskMarkup(task, state.date)).join('');
  document.querySelector('#focus-list').innerHTML = otherTasks.map((task) => taskMarkup(task, state.date)).join('');
  document.querySelector('#empty-state').hidden = state.focusTasks.length !== 0;
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
    await controller.quickCreate(input.value, scheduledDate);
    input.value = '';
    setSelectedDate('inbox');
    showPopupSuccess(getQuickAddFeedback({ scheduledDate }));
    await refresh();
    input.focus();
  } catch {
    message.textContent = '任务没有保存。你的输入还在，请检查标题后重试。';
    input.focus();
  }
});

document.querySelector('#open-dashboard').addEventListener('click', openDashboard);

input.focus();
refresh().catch(() => { message.textContent = '任务列表暂时无法加载。请重新打开扩展。'; });

chrome.runtime.onMessage.addListener((runtimeMessage) => {
  if (runtimeMessage?.type === 'TASK_CHANGED') {
    refresh().catch(() => { message.textContent = '任务列表暂时无法加载。请重新打开扩展。'; });
  }
});
