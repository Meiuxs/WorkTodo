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

function isAllPlannedComplete({ overdue, planned, summary }) {
  return overdue.length === 0
    && planned.length === 0
    && summary.plannedCount > 0
    && summary.completionRate === 1;
}

export function createTodayView({ root, query, statistics, tagService, today, onAction, onEdit, onError, getResourceCounts }) {
  // 顶部快速记录已经是今日页唯一的主入口，空状态只补充方向，不再重复放按钮。
  function plannedEmpty() {
    return emptyStateMarkup({
      title: '今天还没有待办',
      text: '今天是个好的开始，在上方写下你的第一个任务吧。',
      art: 'sun',
    });
  }

  function completedDayEmpty() {
    return emptyStateMarkup({
      title: '太棒了！今天的任务已全部搞定',
      text: '今日事今日毕，为你点赞。好好休息一下吧！',
      art: 'celebrate',
      variant: 'celebrate',
    });
  }

  function nextActionMarkup({ nextTask, overdue, summary, planned }) {
    if (nextTask !== null) {
      return `<span class="eyebrow">下一步</span><button type="button" class="today-summary__task" aria-label="下一步任务" data-next-task="${escapeHtml(nextTask.id)}">${escapeHtml(nextTask.title)}</button><span>${overdue.length > 0 ? '先处理逾期事项' : '今天可以推进'}</span>`;
    }
    if (isAllPlannedComplete({ overdue, planned, summary })) {
      return '<span class="eyebrow">今日完成</span><strong>全部搞定</strong><span>好好休息一下吧</span>';
    }
    return '<span class="eyebrow">下一步</span><strong>记录第一件事</strong><span>从上方快速记录开始</span>';
  }

  function bindNextTaskAction() {
    const nextTask = root.querySelector('[data-next-task]');
    nextTask?.addEventListener('click', () => onEdit(nextTask.dataset.nextTask));
  }

  function updateTodaySummary({ overdue, planned, summary }) {
    const nextTask = overdue[0] ?? planned[0] ?? null;
    const progress = summary.completionRate === null ? 0 : Math.round(summary.completionRate * 100);
    const metric = root.querySelector('.today-summary__metric strong');
    const progressLabel = root.querySelector('.progress-block .eyebrow');
    const progressBar = root.querySelector('.progress-block progress');
    const next = root.querySelector('[data-next-action]');
    const todayHeading = root.querySelector('#today-tasks-heading');
    const overdueHeading = root.querySelector('#overdue-heading');

    if (metric !== null) metric.textContent = `${summary.completedCount} / ${summary.plannedCount}`;
    if (progressLabel !== null) {
      progressLabel.textContent = `完成率 ${summary.completionRate === null ? '暂无计划' : `${progress}%`}`;
    }
    if (progressBar !== null) {
      progressBar.value = progress;
      progressBar.textContent = `${progress}%`;
    }
    if (todayHeading !== null) todayHeading.textContent = `今天 · ${planned.length}`;
    if (overdueHeading !== null) overdueHeading.textContent = `逾期 · ${overdue.length}`;
    if (next !== null) {
      next.innerHTML = nextActionMarkup({ nextTask, overdue, summary, planned });
      bindNextTaskAction();
    }
  }

  async function loadData(signal) {
    const date = today();
    const [tasks, completed, summary, tags] = await Promise.all([
      query.today(date),
      query.completed({ completedDate: date }),
      statistics.daily(date),
      tagService.list(),
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
      tags,
    };
  }

  return {
    async render(signal) {
      const data = await loadData(signal);
      if (data === null) return;
      const { date, overdue, planned, completed, summary, childrenByParent, tags } = data;
      const nextTask = overdue[0] ?? planned[0] ?? null;
      const resourceCounts = await getResourceCounts?.([...overdue, ...planned, ...completed]) ?? new Map();
      const progress = summary.completionRate === null ? 0 : Math.round(summary.completionRate * 100);

      root.innerHTML = `<section class="today-focus" aria-label="今日推进摘要">
        <div class="today-summary">
          <div class="today-summary__metric"><span class="eyebrow">今日进度</span><strong>${summary.completedCount} / ${summary.plannedCount}</strong><span>项计划已完成</span></div>
          <div class="progress-block"><span class="eyebrow" id="today-progress-label">完成率 ${summary.completionRate === null ? '暂无计划' : `${progress}%`}</span><progress aria-labelledby="today-progress-label" value="${progress}" max="100">${progress}%</progress></div>
        </div>
          <div class="today-summary__next" data-next-action>
          ${nextActionMarkup({ nextTask, overdue, summary, planned })}
        </div>
      </section>
      ${overdue.length > 0 ? `<section class="view-section view-section--overdue" aria-labelledby="overdue-heading">
        <div class="section-heading"><div><h2 id="overdue-heading">逾期 · ${overdue.length}</h2><p>先处理已经越过计划日期的任务。</p></div></div>
        <div id="overdue-list"></div>
      </section>` : ''}
      <section class="view-section" aria-labelledby="today-tasks-heading">
        <div class="section-heading"><div><h2 id="today-tasks-heading">今天 · ${planned.length}</h2><p>${formatDate(date)}</p></div></div>
        <div id="today-list"></div>
      </section>
      <details class="completed-fold">
        <summary id="completed-today-count">已完成 ${completed.length} 项</summary>
        <div id="completed-today-list"></div>
      </details>`;

      const listOptions = { today: date, tags, onAction, onEdit, onError, resourceCounts, childrenByParent };
      if (overdue.length > 0) {
        renderTaskList(root.querySelector('#overdue-list'), overdue, {
          ...listOptions,
          emptyMessage: '没有逾期任务。',
        });
      }
      if (planned.length === 0) {
        root.querySelector('#today-list').innerHTML = isAllPlannedComplete({ overdue, planned, summary })
          ? completedDayEmpty()
          : plannedEmpty();
      } else {
        renderTaskList(root.querySelector('#today-list'), planned, listOptions);
      }
      renderTaskList(root.querySelector('#completed-today-list'), completed, {
        ...listOptions,
        emptyMessage: '今天还没有完成记录。',
      });
      bindNextTaskAction();
    },

    /* 动作后重取数据：集合不变时只替换变化的行，否则整页重渲染。 */
    async patch(signal) {
      const data = await loadData(signal);
      if (data === null) return;
      const { date, overdue, planned, completed, summary, childrenByParent, tags } = data;
      const resourceCounts = await getResourceCounts?.([...overdue, ...planned, ...completed]) ?? new Map();
      if (signal?.aborted) return;
      updateTodaySummary({ overdue, planned, summary });
      const rowOptions = { today: date, tags, resourceCounts, childrenByParent };
      // 折叠区的完成列表也在受管范围内：刚完成的任务从“今天”迁进“已完成”时，
      // 协调算法能搬移节点而不是把它当成孤儿回退整页渲染。
      const containers = [
        {
          container: root.querySelector('#today-list'),
          tasks: planned,
          onEmpty: () => {
            root.querySelector('#today-list').innerHTML = isAllPlannedComplete({ overdue, planned, summary })
              ? completedDayEmpty()
              : plannedEmpty();
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
