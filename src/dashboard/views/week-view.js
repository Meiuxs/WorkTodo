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
      root.innerHTML = `<section class="view-section" aria-labelledby="week-heading">
        <div class="section-heading">
          <div>
            <h2 id="week-heading">${singleDate ? '明天计划' : '本周计划'} · ${range}</h2>
            <p>${plannedDays.length === 0 ? '当前没有安排，先记录一件要推进的事。' : `显示 ${plannedDays.length} 个有计划的日期，共 ${allTasks.length} 项。`}完成、取消和删除规则与今天页一致。</p>
          </div>
        </div>
        <div class="week-grid${plannedDays.length === 0 ? ' week-grid--empty' : ''}"></div>
      </section>`;

      const grid = root.querySelector('.week-grid');
      if (plannedDays.length === 0) {
        grid.innerHTML = `<div class="week-empty" role="status"><strong>${singleDate ? '明天还没有计划' : '本周还没有计划'}</strong><span>用下方快速记录，先把下一步写下来。</span></div>`;
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
