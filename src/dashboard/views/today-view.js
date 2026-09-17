import { renderTaskList } from '../task-list.js';

function formatDate(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${date}T00:00:00`));
}

export function createTodayView({ root, query, statistics, today, onAction, onEdit, onError }) {
  return {
    async render() {
      const date = today();
      const [tasks, completed, summary] = await Promise.all([
        query.today(date),
        query.completed({ completedDate: date }),
        statistics.daily(date),
      ]);
      const overdue = tasks.filter((task) => task.scheduledDate !== null && task.scheduledDate < date);
      const planned = tasks.filter((task) => task.scheduledDate === date);
      const progress = summary.completionRate === null ? 0 : Math.round(summary.completionRate * 100);

      root.innerHTML = `<section class="today-summary" aria-label="今日完成摘要">
        <div><strong>${summary.completedCount} / ${summary.plannedCount}</strong><span>今日计划已完成</span></div>
        <div class="progress-block"><span>完成率 ${summary.completionRate === null ? '暂无计划' : `${progress}%`}</span><progress value="${progress}" max="100">${progress}%</progress></div>
      </section>
      ${overdue.length > 0 ? `<section class="view-section view-section--overdue" aria-labelledby="overdue-heading">
        <div class="section-heading"><div><h2 id="overdue-heading">逾期 · ${overdue.length}</h2><p>先处理已经越过计划日期的任务。</p></div></div>
        <div id="overdue-list"></div>
      </section>` : ''}
      <section class="view-section" aria-labelledby="today-tasks-heading">
        <div class="section-heading"><div><h2 id="today-tasks-heading">今天 · ${planned.length}</h2><p>${formatDate(date)}，按星标、优先级和时间排列。</p></div></div>
        <div id="today-list"></div>
      </section>
      <details class="completed-fold" ${completed.length === 0 ? '' : ''}>
        <summary>已完成 ${completed.length} 项</summary>
        <div id="completed-today-list"></div>
      </details>`;

      const listOptions = { today: date, onAction, onEdit, onError };
      if (overdue.length > 0) {
        renderTaskList(root.querySelector('#overdue-list'), overdue, {
          ...listOptions,
          emptyMessage: '没有逾期任务。',
        });
      }
      renderTaskList(root.querySelector('#today-list'), planned, {
        ...listOptions,
        emptyMessage: '今天暂时没有待办。先记录一件要做的事。',
      });
      renderTaskList(root.querySelector('#completed-today-list'), completed, {
        ...listOptions,
        emptyMessage: '今天还没有完成记录。',
      });
      root.querySelector('[data-focus-quick-add]')?.addEventListener('click', () => {
        document.querySelector('#quick-add-title')?.focus();
      });
    },
  };
}
