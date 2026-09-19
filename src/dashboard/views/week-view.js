import { addLocalDays, formatLocalDay, formatLocalDayWithWeekday } from '../../domain/dates.js';
import { renderTaskList } from '../task-list.js';

export function createWeekView({
  root,
  query,
  today,
  onAction,
  onEdit,
  onError,
  getResourceCounts,
  singleDate = false,
}) {
  return {
    async render(signal) {
      const anchor = today();
      const tomorrow = addLocalDays(anchor, 1);
      const result = singleDate
        ? {
            startDate: tomorrow,
            endDate: tomorrow,
            days: [tomorrow],
            byDate: { [tomorrow]: await query.tomorrow(anchor) },
          }
        : await query.week(anchor);

      if (signal?.aborted) return;
      const allTasks = result.days.flatMap((date) => result.byDate[date] ?? []);
      const plannedDays = result.days.filter((date) => (result.byDate[date] ?? []).length > 0);
      const resourceCounts = await getResourceCounts?.(allTasks) ?? new Map();
      // 起止同日时只写一次日期，避免出现「9月19日 至 9月19日」。
      const range = result.startDate === result.endDate
        ? formatLocalDay(result.startDate)
        : `${formatLocalDay(result.startDate)} 至 ${formatLocalDay(result.endDate)}`;
      // 说明行只在有数据时出现：空状态由下方 .empty-state 唯一表达，避免同一屏说两遍同一件事。
      const rangeSummary = singleDate
        ? `明天有 ${allTasks.length} 项计划。`
        : `本周有 ${plannedDays.length} 天安排了任务，共 ${allTasks.length} 项。`;
      root.innerHTML = `<section class="view-section" aria-labelledby="week-heading">
        <div class="section-heading">
          <div>
            <h2 id="week-heading">${singleDate ? '明天计划' : '本周计划'} · ${range}</h2>
            ${plannedDays.length === 0 ? '' : `<p>${rangeSummary}</p>`}
          </div>
        </div>
        <div class="week-grid${plannedDays.length === 0 ? ' week-grid--empty' : ''}"></div>
      </section>`;

      const grid = root.querySelector('.week-grid');
      if (plannedDays.length === 0) {
        grid.innerHTML = `<div class="empty-state">
          <p class="empty-state__title">${singleDate ? '明天还没有计划' : '本周还没有计划'}</p>
          <p class="empty-state__text">${singleDate ? '先把明天要做的一件事写下来。' : '先记录一件要推进的事，再回来安排日期。'}</p>
          <button type="button" class="button-primary empty-state__action" data-focus-quick-add>记录一件事</button>
        </div>`;
        grid.querySelector('[data-focus-quick-add]').addEventListener('click', () => {
          document.querySelector('#quick-add-title')?.focus();
        });
        return;
      }
      if (plannedDays.length === 1) grid.classList.add('week-grid--single');
      for (const date of plannedDays) {
        const tasks = result.byDate[date] ?? [];
        const isToday = date === anchor;
        const section = document.createElement('section');
        section.className = `week-day${isToday ? ' week-day--today' : ''}`;
        section.innerHTML = `<div class="week-day__header"><div><h3>${formatLocalDayWithWeekday(date)}</h3><span class="week-day__count">${tasks.length} 项计划</span></div>${isToday ? '<span class="week-day__focus">今天</span>' : ''}</div><div class="week-day__tasks"></div>`;
        grid.append(section);
        renderTaskList(section.querySelector('.week-day__tasks'), tasks, {
          today: anchor,
          onAction,
          onEdit,
          onError,
          resourceCounts,
          emptyMessage: '这一天没有计划。',
        });
      }
    },
  };
}
