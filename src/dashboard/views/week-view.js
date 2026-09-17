import { addLocalDays } from '../../domain/dates.js';
import { renderTaskList } from '../task-list.js';

export function createWeekView({
  root,
  query,
  today,
  onAction,
  onEdit,
  onError,
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
      root.innerHTML = `<section class="view-section" aria-labelledby="week-heading">
        <div class="section-heading">
          <div>
            <h2 id="week-heading">${singleDate ? '明天计划' : '本周计划'} · ${result.startDate} 至 ${result.endDate}</h2>
            <p>只显示有计划的日期。完成、取消和删除规则与今天页一致。</p>
          </div>
        </div>
        <div class="week-grid"></div>
      </section>`;

      const grid = root.querySelector('.week-grid');
      for (const date of result.days) {
        const section = document.createElement('section');
        section.className = 'week-day';
        section.innerHTML = `<h3>${date}</h3><div class="week-day__tasks"></div>`;
        grid.append(section);
        renderTaskList(section.querySelector('.week-day__tasks'), result.byDate[date] ?? [], {
          today: anchor,
          onAction,
          onEdit,
          onError,
          emptyMessage: '这一天没有计划。',
        });
      }
    },
  };
}
