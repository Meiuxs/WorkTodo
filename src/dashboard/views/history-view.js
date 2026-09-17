import { renderTaskList } from '../task-list.js';

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function startOfWeek(date) {
  const value = new Date(`${date}T00:00:00`);
  const offset = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function formatRate(rate) {
  return rate === null ? '暂无计划' : `${Math.round(rate * 100)}%`;
}

export function createHistoryView({ root, query, statistics, today, onAction, onEdit, onError }) {
  let mode = 'daily';
  let anchor = today();

  return {
    async render() {
      const fromDate = mode === 'daily' ? anchor : startOfWeek(anchor);
      const toDate = mode === 'daily' ? anchor : addDays(fromDate, 6);
      const [summary, completed] = await Promise.all([
        mode === 'daily' ? statistics.daily(anchor) : statistics.weekly(fromDate),
        query.completed({ completedFrom: fromDate, completedTo: toDate }),
      ]);
      const rangeText = mode === 'daily' ? anchor : `${fromDate} 至 ${toDate}`;
      root.innerHTML = `<section class="view-section" aria-labelledby="history-heading">
        <div class="section-heading">
          <div><h2 id="history-heading">工作记录</h2><p>完成记录按实际完成日期统计；计划任务按计划日期统计。</p></div>
          <div class="segmented-control" role="group" aria-label="记录范围">
            <button type="button" data-history-mode="daily" aria-pressed="${mode === 'daily'}">按日</button>
            <button type="button" data-history-mode="weekly" aria-pressed="${mode === 'weekly'}">按周</button>
          </div>
        </div>
        <div class="history-toolbar">
          <label>${mode === 'daily' ? '查看日期' : '所在周'}<input type="date" id="history-date" value="${anchor}"></label>
          <span class="filter-count">${rangeText}</span>
        </div>
        <dl class="metrics">
          <div><dt>实际完成</dt><dd>${summary.completedCount}</dd></div>
          <div><dt>计划任务</dt><dd>${summary.plannedCount}</dd></div>
          <div><dt>新增任务</dt><dd>${summary.createdCount}</dd></div>
          <div><dt>延期次数</dt><dd>${summary.postponedCount}</dd></div>
          <div><dt>完成率</dt><dd>${formatRate(summary.completionRate)}</dd></div>
        </dl>
        <h3>实际完成明细</h3>
        <div id="history-list"></div>
      </section>`;
      root.querySelectorAll('[data-history-mode]').forEach((button) => {
        button.addEventListener('click', async () => {
          mode = button.dataset.historyMode;
          await this.render();
        });
      });
      root.querySelector('#history-date').addEventListener('change', async (event) => {
        if (event.target.value.length === 0) return;
        anchor = event.target.value;
        await this.render();
      });
      renderTaskList(root.querySelector('#history-list'), completed, {
        today: today(),
        onAction,
        onEdit,
        onError,
        emptyMessage: '这个区间还没有实际完成记录。',
      });
    },
  };
}
