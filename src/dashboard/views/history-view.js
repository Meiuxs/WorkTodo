import { addLocalDays, endOfWeek, formatLocalDay, formatLocalDayWithWeekday, startOfWeek } from '../../domain/dates.js';
import { renderTaskList } from '../task-list.js';
import { runViewAction } from '../../shared/ui.js';
import { shouldShowSummaryEditor } from '../../shared/ux.js';

function formatRate(rate) {
  return rate === null ? '暂无计划' : `${Math.round(rate * 100)}%`;
}

export function createHistoryView({
  root,
  query,
  statistics,
  summaryService,
  today,
  onAction,
  onEdit,
  onError,
  getResourceCounts,
}) {
  let mode = 'daily';
  let anchor = today();
  let renderVersion = 0;
  let summaryVersion = 0;

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
      const requestedMode = mode;
      const requestedAnchor = anchor;
      const fromDate = requestedMode === 'daily' ? requestedAnchor : startOfWeek(requestedAnchor);
      const toDate = requestedMode === 'daily' ? requestedAnchor : endOfWeek(requestedAnchor);
      let summary;
      let completed;
      try {
        [summary, completed] = await Promise.all([
          requestedMode === 'daily' ? statistics.daily(requestedAnchor) : statistics.weekly(fromDate),
          query.completed({ completedFrom: fromDate, completedTo: toDate }),
        ]);
      } catch (error) {
        if (signal?.aborted || requestVersion !== renderVersion) return;
        throw error;
      }
      if (signal?.aborted || requestVersion !== renderVersion) return;
      const resourceCounts = await getResourceCounts?.(completed) ?? new Map();
      // 界面上的范围文案用中文日期；服务层生成的总结文本仍保留 ISO，便于粘贴后机器解析。
      const rangeText = requestedMode === 'daily'
        ? formatLocalDayWithWeekday(requestedAnchor)
        : `${formatLocalDay(fromDate)} 至 ${formatLocalDay(toDate)}`;
      const plannedCompletedLabel = requestedMode === 'weekly' ? '本周计划并完成' : '计划并完成';
      const carriedOverCompletedLabel = requestedMode === 'weekly'
        ? '历史延期到本周完成'
        : '历史延期完成';
      root.innerHTML = `<section class="view-section" aria-labelledby="history-heading">
        <div class="section-heading">
          <div><h2 id="history-heading">工作记录</h2><p>完成记录按实际完成日期统计；计划任务按计划日期统计。</p></div>
          <div class="segmented-control" role="group" aria-label="记录范围">
            <button type="button" data-history-mode="daily" aria-pressed="${requestedMode === 'daily'}">按日</button>
            <button type="button" data-history-mode="weekly" aria-pressed="${requestedMode === 'weekly'}">按周</button>
          </div>
        </div>
        <div class="history-toolbar">
          <label>${requestedMode === 'daily' ? '查看日期' : '所在周'}<input type="date" id="history-date" value="${requestedAnchor}"></label>
          <span class="filter-count">${rangeText}</span>
        </div>
        <dl class="metrics">
          <div><dt>实际完成</dt><dd>${summary.completedCount}</dd></div>
          <div><dt>计划任务</dt><dd>${summary.plannedCount}</dd></div>
          <div><dt>新增任务</dt><dd>${summary.createdCount}</dd></div>
          <div><dt>延期次数</dt><dd>${summary.postponedCount}</dd></div>
          <div><dt>${plannedCompletedLabel}</dt><dd>${summary.plannedCompletedCount}</dd></div>
          <div><dt>${carriedOverCompletedLabel}</dt><dd>${summary.carriedOverCompletedCount}</dd></div>
          <div><dt>完成率</dt><dd>${formatRate(summary.completionRate)}</dd></div>
        </dl>
        <p class="history-conclusion" data-history-conclusion>这段时间实际完成 ${summary.completedCount} 项，完成率 ${formatRate(summary.completionRate)}。</p>
        <section class="summary-panel" aria-labelledby="history-summary-heading">
          <div>
            <h3 id="history-summary-heading">规则模板总结</h3>
            <p>只使用本地统计和已完成任务标题生成纯文本。</p>
          </div>
          <div class="summary-actions" role="group" aria-label="生成总结">
            <button type="button" class="button-secondary" data-summary-kind="week">生成本周总结</button>
            <button type="button" class="button-secondary" data-summary-kind="month">生成本月总结</button>
          </div>
          <p class="summary-empty" data-summary-empty>先看结论，再按需生成可复制总结。</p>
          <textarea id="history-summary-text" aria-label="总结文本" readonly hidden></textarea>
          <button type="button" class="button-secondary summary-copy" data-summary-copy disabled hidden>复制总结</button>
        </section>
        <h3>实际完成明细</h3>
        <div id="history-list"></div>
      </section>`;
      root.querySelectorAll('[data-history-mode]').forEach((button) => {
        button.addEventListener('click', () => {
          mode = button.dataset.historyMode;
          invalidateSummary();
          runViewAction(() => this.render(signal), { signal, onError });
        });
      });
      root.querySelector('#history-date').addEventListener('change', (event) => {
        if (event.target.value.length === 0) return;
        anchor = event.target.value;
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
        onAction,
        onEdit,
        onError,
        resourceCounts,
        emptyMessage: '这个区间还没有实际完成记录。',
      });
    },
  };
}
