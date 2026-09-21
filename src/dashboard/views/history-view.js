import { endOfWeek, formatLocalDay, formatLocalDayWithWeekday, startOfWeek, weekdayLabel } from '../../domain/dates.js';
import { renderTaskList } from '../task-list.js';
import { readHistoryState, writeParams } from '../hash.js';
import { runViewAction } from '../../shared/ui.js';
import { shouldShowSummaryEditor } from '../../shared/ux.js';

function formatRate(rate) {
  return rate === null ? '暂无计划' : `${Math.round(rate * 100)}%`;
}

function renderWeeklyDays(days, todayDate) {
  const maxCompleted = Math.max(1, ...days.map((day) => day.completedCount ?? 0));
  return days.map((day) => {
    const completedCount = day.completedCount ?? 0;
    const plannedCount = day.plannedCount ?? 0;
    const postponedCount = day.postponedCount ?? 0;
    const height = completedCount === 0
      ? 8
      : Math.max(12, Math.round((completedCount / maxCompleted) * 100));
    const isToday = day.date === todayDate;
    const hasAttention = postponedCount > 0 || (plannedCount > completedCount && plannedCount > 0);
    const classes = [
      'history-day',
      isToday ? 'history-day--today' : '',
      hasAttention ? 'history-day--attention' : '',
    ].filter(Boolean).join(' ');
    const label = isToday ? '今天' : weekdayLabel(day.date);
    const statusText = plannedCount === 0
      ? '无计划'
      : postponedCount > 0
        ? `延期 ${postponedCount} 次`
        : plannedCount > completedCount
          ? '待处理'
          : '按计划';
    const ariaLabel = `${label}：完成 ${completedCount} 项，计划 ${plannedCount} 项，${statusText}`;
    return `<div class="${classes}" role="listitem" aria-label="${ariaLabel}">
      <div class="history-day__column"><span style="height: ${height}%"></span></div>
      <strong>${completedCount}</strong>
      <small>${label}</small>
      <small class="history-day__status">${statusText}</small>
    </div>`;
  }).join('');
}

export function createHistoryView({
  root,
  query,
  statistics,
  tagService,
  summaryService,
  today,
  onAction,
  onEdit,
  onError,
  getResourceCounts,
}) {
  let mode = 'weekly';
  let anchor = today();
  let renderVersion = 0;
  let summaryVersion = 0;

  /* 记录范围也是视图状态：每次渲染从 hash 读回，刷新和后退能回到看过的区间。
     无历史栈的环境（Node 单测）里跳过，保留模块内状态以免点击被默认值覆盖。 */
  function syncRangeFromHash() {
    if (globalThis.history?.replaceState === undefined) return;
    const state = readHistoryState();
    mode = state.mode === 'daily' || state.mode === 'weekly' ? state.mode : 'weekly';
    anchor = /^\d{4}-\d{2}-\d{2}$/.test(state.date ?? '') ? state.date : today();
  }

  function writeRange() {
    writeParams({ mode, date: anchor });
  }

  function invalidateSummary() {
    summaryVersion += 1;
    const output = root.querySelector('#history-summary-text');
    if (output !== null) output.value = '';
    const copy = root.querySelector('[data-summary-copy]');
    if (copy !== null) {
      copy.disabled = true;
      copy.hidden = true;
    }
    const editor = root.querySelector('#history-summary-text');
    if (editor !== null) editor.hidden = true;
    const empty = root.querySelector('[data-summary-empty]');
    if (empty !== null) empty.hidden = false;
  }

  return {
    async render(signal) {
      const requestVersion = ++renderVersion;
      summaryVersion += 1;
      syncRangeFromHash();
      const requestedMode = mode;
      const requestedAnchor = anchor;
      const fromDate = requestedMode === 'daily' ? requestedAnchor : startOfWeek(requestedAnchor);
      const toDate = requestedMode === 'daily' ? requestedAnchor : endOfWeek(requestedAnchor);
      let summary;
      let completed;
      let weeklyDays;
      let tags;
      try {
        [summary, completed, weeklyDays, tags] = await Promise.all([
          requestedMode === 'daily' ? statistics.daily(requestedAnchor) : statistics.weekly(fromDate),
          query.completed({ completedFrom: fromDate, completedTo: toDate }),
          requestedMode === 'weekly' && typeof statistics.weeklyDaily === 'function'
            ? statistics.weeklyDaily(fromDate)
            : [],
          tagService.list(),
        ]);
      } catch (error) {
        if (signal?.aborted || requestVersion !== renderVersion) return;
        throw error;
      }
      if (signal?.aborted || requestVersion !== renderVersion) return;
      const resourceCounts = await getResourceCounts?.(completed) ?? new Map();
      if (signal?.aborted || requestVersion !== renderVersion) return;
      // 界面上的范围文案用中文日期；服务层生成的总结文本仍保留 ISO，便于粘贴后机器解析。
      const rangeText = requestedMode === 'daily'
        ? formatLocalDayWithWeekday(requestedAnchor)
        : `${formatLocalDay(fromDate)} 至 ${formatLocalDay(toDate)}`;
      const plannedCompletedLabel = requestedMode === 'weekly' ? '本周计划并完成' : '计划并完成';
      const carriedOverCompletedLabel = requestedMode === 'weekly'
        ? '历史延期到本周完成'
        : '历史延期完成';
      const completionPercent = summary.completionRate === null ? 0 : Math.round(summary.completionRate * 100);
      const completionLabel = summary.completionRate === null
        ? '完成率暂无计划'
        : `完成率 ${completionPercent}%`;
      const todayDate = today();
      const breakdown = requestedMode === 'weekly'
        ? `<div class="history-breakdown__heading"><h3 id="history-breakdown-heading">工作节奏</h3><span>用每天的完成量看变化，不只看一个百分比。</span></div>
          <div class="history-days" role="list" aria-label="本周每日完成量">${renderWeeklyDays(weeklyDays, todayDate)}</div>
          <div class="history-legend"><span>已完成</span><span>有延期或待处理</span></div>`
        : `<div class="history-breakdown__heading"><h3 id="history-breakdown-heading">今日回顾</h3><span>日视图优先查看完成事项，不强行展示趋势。</span></div>
          <p class="history-day-summary">${summary.completedCount === 0 ? '今天还没有完成记录，先完成一件小事，再回来看看进度。' : `今天完成 ${summary.completedCount} 项，计划任务 ${summary.plannedCount} 项。`}</p>`;
      root.innerHTML = `<section class="view-section" aria-labelledby="history-heading">
        <div class="section-heading">
          <div><h2 id="history-heading">工作记录</h2><p>完成记录看实际完成日期，计划任务看计划日期。</p></div>
          <div class="segmented-control" role="group" aria-label="记录范围">
            <button type="button" data-history-mode="daily" aria-pressed="${requestedMode === 'daily'}">按日</button>
            <button type="button" data-history-mode="weekly" aria-pressed="${requestedMode === 'weekly'}">按周</button>
          </div>
        </div>
        <div class="history-toolbar">
          <label>${requestedMode === 'daily' ? '查看日期' : '所在周'}<input type="date" id="history-date" value="${requestedAnchor}"></label>
          <span class="filter-count">${rangeText}</span>
        </div>
        <div class="history-report-top">
          <div class="history-insight"><span class="eyebrow">本段结论</span><strong>${summary.completedCount === 0 ? '还没有完成记录' : `已完成 ${summary.completedCount} 项`}</strong><span>${rangeText} · ${summary.completionRate === null ? '暂无可计算完成率' : `完成率 ${completionPercent}%`}</span></div>
          <div class="history-rate" aria-label="${completionLabel}"><div class="history-rate__value">${summary.completionRate === null ? '—' : `${completionPercent}%`}</div><div class="history-rate__track"><span style="width: ${completionPercent}%"></span></div><span>${summary.completionRate === null ? '暂无计划' : '计划任务完成进度'}</span></div>
        </div>
        <dl class="metrics report-metrics">
          <div><dt>实际完成</dt><dd>${summary.completedCount}</dd></div>
          <div><dt>计划任务</dt><dd>${summary.plannedCount}</dd></div>
          <div><dt>${plannedCompletedLabel}</dt><dd>${summary.plannedCompletedCount}</dd></div>
          <div><dt>延期次数</dt><dd>${summary.postponedCount}</dd></div>
        </dl>
        <details class="history-extra-metrics">
          <summary>更多统计</summary>
          <dl>
            <div><dt>新增任务</dt><dd>${summary.createdCount}</dd></div>
            <div><dt>${carriedOverCompletedLabel}</dt><dd>${summary.carriedOverCompletedCount}</dd></div>
            <div><dt>完成率</dt><dd>${formatRate(summary.completionRate)}</dd></div>
          </dl>
        </details>
        <section class="history-breakdown" aria-labelledby="history-breakdown-heading">
          ${breakdown}
        </section>
        <section class="summary-panel" aria-labelledby="history-summary-heading">
          <div>
            <h3 id="history-summary-heading">规则模板总结</h3>
            <p>总结在本机生成，不上传任何内容。</p>
          </div>
          <div class="summary-actions" role="group" aria-label="生成总结">
            <button type="button" class="button-secondary" data-summary-kind="week">生成本周总结</button>
            <button type="button" class="button-secondary" data-summary-kind="month">生成本月总结</button>
          </div>
          <p class="summary-empty" data-summary-empty>先看结论，再按需生成可复制总结。</p>
          <textarea id="history-summary-text" aria-label="总结文本" readonly hidden></textarea>
          <button type="button" class="button-secondary summary-copy" data-summary-copy disabled hidden>复制总结</button>
        </section>
        <section class="history-details" aria-labelledby="history-details-heading">
          <div class="history-details__heading"><h3 id="history-details-heading">实际完成明细</h3><span>${completed.length} 项</span></div>
          <div class="history-details__card"><div id="history-list"></div></div>
        </section>
      </section>`;
      root.querySelectorAll('[data-history-mode]').forEach((button) => {
        button.addEventListener('click', () => {
          mode = button.dataset.historyMode;
          writeRange();
          invalidateSummary();
          runViewAction(() => this.render(signal), { signal, onError });
        });
      });
      root.querySelector('#history-date').addEventListener('change', (event) => {
        if (event.target.value.length === 0) return;
        anchor = event.target.value;
        writeRange();
        invalidateSummary();
        runViewAction(() => this.render(signal), { signal, onError });
      });
      root.querySelectorAll('[data-summary-kind]').forEach((button) => {
        button.addEventListener('click', () => {
          const requestedSummaryVersion = ++summaryVersion;
          const requestedSummaryAnchor = anchor;
          runViewAction(async () => {
            let generated;
            try {
              generated = button.dataset.summaryKind === 'week'
                ? await summaryService.weekly(requestedSummaryAnchor)
                : await summaryService.monthly(requestedSummaryAnchor);
            } catch (error) {
              if (
                signal?.aborted
                || requestedSummaryVersion !== summaryVersion
                || requestedSummaryAnchor !== anchor
              ) {
                return;
              }
              throw error;
            }
            if (
              signal?.aborted
              || requestedSummaryVersion !== summaryVersion
              || requestedSummaryAnchor !== anchor
            ) {
              return;
            }
            const output = root.querySelector('#history-summary-text');
            const copy = root.querySelector('[data-summary-copy]');
            if (output === null) return;
            output.value = generated.text;
            output.hidden = !shouldShowSummaryEditor(generated.text);
            const empty = root.querySelector('[data-summary-empty]');
            if (empty !== null) empty.hidden = output.hidden;
            if (copy !== null) {
              copy.disabled = output.hidden;
              copy.hidden = output.hidden;
            }
          }, { signal, onError });
        });
      });
      root.querySelector('[data-summary-copy]').addEventListener('click', () => {
        runViewAction(async () => {
          const output = root.querySelector('#history-summary-text');
          if (output === null || output.value.length === 0) return;
          await summaryService.copyText(output.value);
        }, { signal, onError });
      });
      renderTaskList(root.querySelector('#history-list'), completed, {
        today: today(),
        tags,
        onAction,
        onEdit,
        onError,
        resourceCounts,
        emptyMessage: '这个区间还没有实际完成记录。',
      });
      writeRange();
    },

    /* 回顾页是聚合报表，任务行变化后直接重建，不做局部替换。 */
    patch(signal) {
      return this.render(signal);
    },
  };
}
