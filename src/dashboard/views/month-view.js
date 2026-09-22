import { formatLocalDay, formatLocalDayWithWeekday, toLocalDate, weekdayLabel } from '../../domain/dates.js';
import { runViewAction } from '../../shared/ui.js';
import { renderTaskList } from '../task-list.js';

// 桌面与窄屏共用同一套密度：每格最多显示 3 条，超出的收进“+N 更多”弹窗，
// 免得单个格子被长列表撑高、整月网格高度参差。
const MAX_VISIBLE_TASKS = 3;

function shiftMonth(date, offset) {
  const [year, month] = date.split('-').map(Number);
  return toLocalDate(new Date(year, month - 1 + offset, 1));
}

function formatMonth(startDate) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' })
    .format(new Date(`${startDate}T00:00:00`));
}

export function createMonthView({
  root,
  query,
  tagService,
  today,
  onAction,
  onEdit,
  onError,
  dayDialog = null,
}) {
  let anchor = today();
  let renderVersion = 0;
  // 记录由“+N 更多”打开的日期；列表重渲染后据此把弹窗刷新到最新数据。
  let openDayDate = null;

  if (dayDialog !== null) {
    // Esc、遮罩与关闭按钮都会触发 close：统一在这里清空打开状态，避免下次渲染误刷新已关闭的弹窗。
    dayDialog.addEventListener('close', () => { openDayDate = null; });
  }

  function renderDayTasks(date, tasks, tags) {
    dayDialog.querySelector('[data-day-dialog-title]').textContent = formatLocalDayWithWeekday(date);
    dayDialog.querySelector('[data-day-dialog-summary]').textContent = `${tasks.length} 项任务`;
    renderTaskList(dayDialog.querySelector('[data-day-dialog-list]'), tasks, {
      today: anchor,
      tags,
      onAction,
      onEdit,
      onError,
      emptyMessage: '这一天没有任务。',
    });
  }

  function openDayTasks(date, tasks, tags) {
    if (dayDialog === null) return;
    openDayDate = date;
    renderDayTasks(date, tasks, tags);
    if (!dayDialog.open) dayDialog.showModal();
  }

  // 弹窗打开期间月历会因任务动作整页重渲染：这里按最新数据刷新弹窗，当天清空则自动关闭。
  function syncDayDialog(calendar, tags) {
    if (dayDialog === null || !dayDialog.open || openDayDate === null) return;
    const tasks = calendar.byDate[openDayDate] ?? [];
    if (tasks.length === 0) {
      dayDialog.close();
      return;
    }
    renderDayTasks(openDayDate, tasks, tags);
  }

  return {
    async render(signal) {
      const requestVersion = ++renderVersion;
      const requestedAnchor = anchor;
      let calendar;
      let tags;
      try {
        [calendar, tags] = await Promise.all([query.month(requestedAnchor), tagService.list()]);
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
        <div class="section-heading month-heading">
          <div>
            <div class="month-nav" role="group" aria-label="月份切换">
              <button type="button" data-month-nav="-1" aria-label="上个月" title="上个月">‹</button>
              <h2 id="month-heading" data-month-label>${label}</h2>
              <button type="button" data-month-nav="1" aria-label="下个月" title="下个月">›</button>
            </div>
            <p>按月查看任务分布。</p>
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
        const date = cell.dataset.date;
        const dayTasks = calendar.byDate[date] ?? [];
        const visibleTasks = dayTasks.slice(0, MAX_VISIBLE_TASKS);
        renderTaskList(cell.querySelector('.month-day__tasks'), visibleTasks, {
          today: requestedAnchor,
          tags,
          onAction,
          onEdit,
          onError,
          emptyMessage: '',
        });
        const hiddenCount = dayTasks.length - visibleTasks.length;
        if (hiddenCount > 0) {
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'month-day__more';
          more.dataset.dayMore = date;
          more.setAttribute('aria-label', `查看 ${formatLocalDay(date)} 的全部 ${dayTasks.length} 项任务`);
          more.textContent = `+${hiddenCount} 更多`;
          cell.append(more);
        }
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

      // “+N 更多”打开当日任务弹窗；用委托绑定，格子重建后无需重挂。
      root.querySelector('.month-grid')?.addEventListener('click', (event) => {
        const more = event.target.closest('[data-day-more]');
        if (more === null) return;
        const date = more.dataset.dayMore;
        openDayTasks(date, calendar.byDate[date] ?? [], tags);
      });

      root.querySelectorAll('[data-month-nav]').forEach((button) => {
        button.addEventListener('click', () => {
          // 翻月后旧日期可能不在新网格里：先收起弹窗，避免停在一个当前不可见的日期上。
          if (dayDialog?.open) dayDialog.close();
          anchor = shiftMonth(anchor, Number(button.dataset.monthNav));
          runViewAction(() => this.render(signal), { signal, onError });
        });
      });

      syncDayDialog(calendar, tags);
    },

    /* 月历是格子矩阵，行级原地替换保不住网格焦点分配（roving tabindex），
       动作后仍然整页重渲染。 */
    patch(signal) {
      return this.render(signal);
    },
  };
}
