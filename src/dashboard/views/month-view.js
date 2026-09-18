import { formatLocalDay, toLocalDate } from '../../domain/dates.js';
import { runViewAction } from '../../shared/ui.js';
import { renderTaskList } from '../task-list.js';

function shiftMonth(date, offset) {
  const [year, month] = date.split('-').map(Number);
  return toLocalDate(new Date(year, month - 1 + offset, 1));
}

function formatMonth(startDate) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' })
    .format(new Date(`${startDate}T00:00:00`));
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function weekdayLabel(date) {
  return WEEKDAY_LABELS[new Date(`${date}T00:00:00`).getDay()];
}

export function createMonthView({
  root,
  query,
  today,
  onAction,
  onEdit,
  onError,
}) {
  let anchor = today();
  let renderVersion = 0;

  return {
    async render(signal) {
      const requestVersion = ++renderVersion;
      const requestedAnchor = anchor;
      let calendar;
      try {
        calendar = await query.month(requestedAnchor);
      } catch (error) {
        if (signal?.aborted || requestVersion !== renderVersion) return;
        throw error;
      }
      if (signal?.aborted || requestVersion !== renderVersion) return;

      const label = formatMonth(calendar.startDate);
      const currentDate = today();
      // 表头直接由第一周的真实日期推出星期，这样无论周起始是哪天，列标题都不会错位。
      const weekdays = (calendar.weeks[0] ?? []).map(weekdayLabel);
      root.innerHTML = `<section class="view-section" aria-labelledby="month-heading">
        <div class="section-heading">
          <div>
            <h2 id="month-heading" data-month-label>${label}</h2>
            <p>按月查看任务分布，点击标题可编辑，点左侧圆圈直接完成。</p>
          </div>
          <div class="month-nav" role="group" aria-label="月份切换">
            <button type="button" data-month-nav="-1">上个月</button>
            <button type="button" data-month-nav="1">下个月</button>
          </div>
        </div>
        <div class="month-grid" role="grid" aria-label="${label}">
          <div class="month-weekdays" role="row">
            ${weekdays.map((weekday) => `<span class="month-weekday" role="columnheader">${weekday}</span>`).join('')}
          </div>
          ${calendar.weeks.map((week) => `<div class="month-week" role="row">
            ${week.map((date) => {
              const inMonth = date >= calendar.startDate && date <= calendar.endDate;
              const isToday = date === currentDate;
              const taskCount = (calendar.byDate[date] ?? []).length;
              return `<section class="month-day${inMonth ? '' : ' month-day--muted'}${isToday ? ' month-day--today' : ''}${taskCount > 0 ? ' month-day--planned' : ''}" role="gridcell"${isToday ? ' aria-current="date"' : ''} data-date="${date}">
                <div class="month-day__header"><h3>${formatLocalDay(date)}</h3>${taskCount > 0 ? `<span class="month-day__count">${taskCount}</span>` : ''}</div>
                <div class="month-day__tasks"></div>
              </section>`;
            }).join('')}
          </div>`).join('')}
        </div>
      </section>`;

      for (const cell of root.querySelectorAll('[data-date]')) {
        renderTaskList(cell.querySelector('.month-day__tasks'), calendar.byDate[cell.dataset.date] ?? [], {
          today: requestedAnchor,
          onAction,
          onEdit,
          onError,
          emptyMessage: '',
        });
      }

      root.querySelectorAll('[data-month-nav]').forEach((button) => {
        button.addEventListener('click', () => {
          anchor = shiftMonth(anchor, Number(button.dataset.monthNav));
          runViewAction(() => this.render(signal), { signal, onError });
        });
      });
    },
  };
}
