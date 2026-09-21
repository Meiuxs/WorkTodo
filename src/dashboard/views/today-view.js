import { renderTaskList, renderTaskRow, arrangeSubtasks, emptyStateMarkup } from '../task-list.js';
import { patchTaskContainers } from '../list-patch.js';
import { escapeHtml } from '../../shared/ui.js';

function formatDate(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${date}T00:00:00`));
}

export function createTodayView({ root, query, statistics, today, onAction, onEdit, onError, getResourceCounts }) {
  // 首屏空状态：不止告诉用户"没有任务"，还要把唯一的下一步动作递到手上。
  function plannedEmpty() {
    return emptyStateMarkup({
      title: '今天还没有待办',
      text: '在上方快速记录里写下一件要做的事，按 Enter 保存后就会出现在这里。',
      action: '记录第一件事',
    });
  }
  function bindEmptyStateActions() {
    root.querySelector('[data-focus-quick-add]')?.addEventListener('click', () => {
      document.querySelector('#quick-add-title')?.focus();
    });
  }

  async function loadData(signal) {
    const date = today();
    const [tasks, completed, summary] = await Promise.all([
      query.today(date),
      query.completed({ completedDate: date }),
      statistics.daily(date),
    ]);
    if (signal?.aborted) return null;
    const rawOverdue = tasks.filter((task) => task.scheduledDate !== null && task.scheduledDate < date);
    const rawPlanned = tasks.filter((task) => task.scheduledDate === date);
    // 今天/逾期都是按日期筛的活跃任务，子任务无日期不会混入；已完成列表会同时包含
    // 已完成的父任务与被级联完成的子任务，逐个列表归位，避免子任务既平铺又嵌套。
    const [overdueArr, plannedArr, completedArr] = await Promise.all([
      arrangeSubtasks(query, rawOverdue),
      arrangeSubtasks(query, rawPlanned),
      arrangeSubtasks(query, completed),
    ]);
    if (signal?.aborted) return null;
    const childrenByParent = new Map([
      ...overdueArr.childrenByParent,
      ...plannedArr.childrenByParent,
      ...completedArr.childrenByParent,
    ]);
    return {
      date,
      overdue: overdueArr.topLevel,
      planned: plannedArr.topLevel,
      completed: completedArr.topLevel,
      summary,
      childrenByParent,
    };
  }

  return {
    async render(signal) {
      const data = await loadData(signal);
      if (data === null) return;
      const { date, overdue, planned, completed, summary, childrenByParent } = data;
      const nextTask = overdue[0] ?? planned[0] ?? null;
      const resourceCounts = await getResourceCounts?.([...overdue, ...planned, ...completed]) ?? new Map();
      const progress = summary.completionRate === null ? 0 : Math.round(summary.completionRate * 100);

      root.innerHTML = `<section class="today-focus" aria-label="今日推进摘要">
        <div class="today-summary">
          <div class="today-summary__metric"><span class="eyebrow">今日进度</span><strong>${summary.completedCount} / ${summary.plannedCount}</strong><span>项计划已完成</span></div>
          <div class="progress-block"><span class="eyebrow">完成率 ${summary.completionRate === null ? '暂无计划' : `${progress}%`}</span><progress value="${progress}" max="100">${progress}%</progress></div>
        </div>
        <div class="today-summary__next" data-next-action>
          <span class="eyebrow">下一步</span>
          ${nextTask === null
            ? '<strong>记录第一件事</strong><span>从上方快速记录开始</span>'
            : `<button type="button" class="today-summary__task" aria-label="下一步任务" data-next-task="${escapeHtml(nextTask.id)}">${escapeHtml(nextTask.title)}</button><span>${overdue.length > 0 ? '先处理逾期事项' : '今天可以推进'}</span>`}
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
      <details class="completed-fold">
        <summary id="completed-today-count">已完成 ${completed.length} 项</summary>
        <div id="completed-today-list"></div>
      </details>`;

      const listOptions = { today: date, onAction, onEdit, onError, resourceCounts, childrenByParent };
      if (overdue.length > 0) {
        renderTaskList(root.querySelector('#overdue-list'), overdue, {
          ...listOptions,
          emptyMessage: '没有逾期任务。',
        });
      }
      if (planned.length === 0) {
        root.querySelector('#today-list').innerHTML = plannedEmpty();
      } else {
        renderTaskList(root.querySelector('#today-list'), planned, listOptions);
      }
      renderTaskList(root.querySelector('#completed-today-list'), completed, {
        ...listOptions,
        emptyMessage: '今天还没有完成记录。',
      });
      bindEmptyStateActions();
      root.querySelector('[data-next-task]')?.addEventListener('click', () => {
        onEdit(root.querySelector('[data-next-task]').dataset.nextTask);
      });
    },

    /* 动作后重取数据：集合不变时只替换变化的行，否则整页重渲染。 */
    async patch(signal) {
      const data = await loadData(signal);
      if (data === null) return;
      const { date, overdue, planned, completed, childrenByParent } = data;
      const resourceCounts = await getResourceCounts?.([...overdue, ...planned, ...completed]) ?? new Map();
      if (signal?.aborted) return;
      const rowOptions = { today: date, resourceCounts, childrenByParent };
      // 折叠区的完成列表也在受管范围内：刚完成的任务从“今天”迁进“已完成”时，
      // 协调算法能搬移节点而不是把它当成孤儿回退整页渲染。
      const containers = [
        {
          container: root.querySelector('#today-list'),
          tasks: planned,
          onEmpty: () => {
            root.querySelector('#today-list').innerHTML = plannedEmpty();
            bindEmptyStateActions();
          },
        },
        { container: root.querySelector('#completed-today-list'), tasks: completed },
      ];
      if (overdue.length > 0) containers.unshift({ container: root.querySelector('#overdue-list'), tasks: overdue });
      const patched = patchTaskContainers(root, containers, {
        renderRow: (task) => renderTaskRow(task, rowOptions),
        collectCounts: () => ({ '#completed-today-count': `已完成 ${completed.length} 项` }),
      });
      if (patched === false) await this.render(signal);
    },
  };
}
