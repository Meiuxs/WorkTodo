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
        <div class="month-grid" aria-label="${label}">
          <div class="month-weekdays" aria-hidden="true">
            ${weekdays.map((weekday) => `<span class="month-weekday">${weekday}</span>`).join('')}
          </div>
          ${calendar.weeks.map((week) => `<div class="month-week">
            ${week.map((date) => {
              const inMonth = date >= calendar.startDate && date <= calendar.endDate;
              const isToday = date === currentDate;
              const taskCount = (calendar.byDate[date] ?? []).length;
              // 不声明 grid/gridcell：格子里有完成、编辑、菜单等多个 Tab 停留点，
              // 复合角色的箭头键浏览模式会和内部控件打架；星期由日期格自己的标签表达。
              return `<section class="month-day${inMonth ? '' : ' month-day--muted'}${isToday ? ' month-day--today' : ''}${taskCount > 0 ? ' month-day--planned' : ''}" aria-label="${formatLocalDay(date)} ${weekdayLabel(date)}${isToday ? '，今天' : ''}"${isToday ? ' aria-current="date"' : ''} data-date="${date}">
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

      // 日期格子之间的方向键增强（非复合角色要求）：左右移动一天，上下移动一周，Home/End 到本周首尾。
      const cells = [...root.querySelectorAll('[data-date]')];
      const startCell = cells.find((cell) => cell.dataset.date === currentDate) ?? cells[0];
      let focusedIndex = cells.indexOf(startCell);
      const focusCell = (index) => {
        if (index < 0 || index >= cells.length) return false;
        focusedIndex = index;
        cells.forEach((cell, cellIndex) => {
          cell.tabIndex = cellIndex === index ? 0 : -1;
        });
        cells[index].focus();
        return true;
      };
      if (focusedIndex >= 0) focusCell(focusedIndex);
      root.querySelector('.month-grid')?.addEventListener('keydown', (event) => {
        // 只在日期格子本身获得焦点时接管方向键，格子内的任务按钮保持自己的行为。
        if (!event.target.matches('[data-date]')) return;
        const index = cells.indexOf(event.target);
        const weekStart = Math.floor(index / 7) * 7;
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          focusCell(event.key === 'Home' ? weekStart : weekStart + 6);
          return;
        }
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        const offset = offsets[event.key];
        if (offset === undefined) return;
        event.preventDefault();
        focusCell(index + offset);
      });

      root.querySelectorAll('[data-month-nav]').forEach((button) => {
        button.addEventListener('click', () => {
          anchor = shiftMonth(anchor, Number(button.dataset.monthNav));
          runViewAction(() => this.render(signal), { signal, onError });
        });
      });
    },

    /* 月历是格子矩阵，行级原地替换保不住网格焦点分配（roving tabindex），
       动作后仍然整页重渲染。 */
    patch(signal) {
      return this.render(signal);
    },
  };
}
