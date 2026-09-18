import { renderTaskList } from '../task-list.js';
import { escapeHtml } from '../../shared/ui.js';

function formatDate(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${date}T00:00:00`));
}

export function createTodayView({ root, query, statistics, today, onAction, onEdit, onError }) {
  return {
    async render(signal) {
      const date = today();
      const [tasks, completed, summary] = await Promise.all([
        query.today(date),
        query.completed({ completedDate: date }),
        statistics.daily(date),
      ]);
      if (signal?.aborted) return;
      const overdue = tasks.filter((task) => task.scheduledDate !== null && task.scheduledDate < date);
      const planned = tasks.filter((task) => task.scheduledDate === date);
      const nextTask = overdue[0] ?? planned[0] ?? null;
      const progress = summary.completionRate === null ? 0 : Math.round(summary.completionRate * 100);

      root.innerHTML = `<section class="today-summary" aria-label="今日完成摘要">
        <div><strong>${summary.completedCount} / ${summary.plannedCount}</strong><span>今日计划已完成</span></div>
        <div class="progress-block"><span>完成率 ${summary.completionRate === null ? '暂无计划' : `${progress}%`}</span><progress value="${progress}" max="100">${progress}%</progress></div>
        <div class="today-summary__next" data-next-action>
          <span class="eyebrow">下一步</span>
          ${nextTask === null
            ? '<strong>记录第一件事</strong><span>从下方快速新增开始</span>'
            : `<button type="button" class="today-summary__task" data-next-task="${escapeHtml(nextTask.id)}">${escapeHtml(nextTask.title)}</button><span>${overdue.length > 0 ? '先处理逾期事项' : '今天可以推进'}</span>`}
        </div>
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
      // 首屏空状态：不止告诉用户"没有任务"，还要把唯一的下一步动作递到手上。
      // 这个 [data-focus-quick-add] 按钮此前只存在于下方的事件绑定里、从未被渲染出来。
      if (planned.length === 0) {
        root.querySelector('#today-list').innerHTML = `<div class="empty-state">
          <p class="empty-state__title">今天还没有待办</p>
          <p class="empty-state__text">在下方输入框记录一件要做的事，按 Enter 保存后就会出现在这里。</p>
          <button type="button" class="button-primary empty-state__action" data-focus-quick-add>记录第一件事</button>
        </div>`;
      } else {
        renderTaskList(root.querySelector('#today-list'), planned, listOptions);
      }
      renderTaskList(root.querySelector('#completed-today-list'), completed, {
        ...listOptions,
        emptyMessage: '今天还没有完成记录。',
      });
      root.querySelector('[data-focus-quick-add]')?.addEventListener('click', () => {
        document.querySelector('#quick-add-title')?.focus();
      });
      root.querySelector('[data-next-task]')?.addEventListener('click', () => {
        onEdit(root.querySelector('[data-next-task]').dataset.nextTask);
      });
    },
  };
}
