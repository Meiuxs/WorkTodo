import { toLocalDate } from '../../domain/dates.js';
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

function formatDay(date) {
  const [, month, day] = date.split('-');
  return `${Number(month)}月${Number(day)}日`;
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

  return {
    async render(signal) {
      const calendar = await query.month(anchor);
      if (signal?.aborted) return;

      const label = formatMonth(calendar.startDate);
      root.innerHTML = `<section class="view-section" aria-labelledby="month-heading">
        <div class="section-heading">
          <div>
            <h2 id="month-heading">月历</h2>
            <p data-month-label>${label}</p>
          </div>
          <div class="month-nav" role="group" aria-label="月份切换">
            <button type="button" data-month-nav="-1">上个月</button>
            <button type="button" data-month-nav="1">下个月</button>
          </div>
        </div>
        <div class="month-grid" role="grid" aria-label="${label}">
          ${calendar.weeks.map((week) => `<div class="month-week" role="row">
            ${week.map((date) => {
              const inMonth = date >= calendar.startDate && date <= calendar.endDate;
              return `<section class="month-day${inMonth ? '' : ' month-day--muted'}" role="gridcell" data-date="${date}">
                <h3>${formatDay(date)}</h3>
                <div class="month-day__tasks"></div>
              </section>`;
            }).join('')}
          </div>`).join('')}
        </div>
      </section>`;

      for (const cell of root.querySelectorAll('[data-date]')) {
        renderTaskList(cell.querySelector('.month-day__tasks'), calendar.byDate[cell.dataset.date] ?? [], {
          today: anchor,
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
