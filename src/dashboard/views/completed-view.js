import { renderTaskList } from '../task-list.js';

export function createCompletedView({ root, query, today, onAction, onEdit, onError, getResourceCounts }) {
  return {
    async render(signal) {
      const [completed, cancelled] = await Promise.all([query.completed(), query.cancelled()]);
      if (signal?.aborted) return;
      const resourceCounts = await getResourceCounts?.([...completed, ...cancelled]) ?? new Map();
      root.innerHTML = `<section class="view-section" aria-labelledby="completed-heading">
        <div class="section-heading"><div><h2 id="completed-heading">已完成 · ${completed.length}</h2><p>按完成时间保留工作记录，可恢复为待办或复制为新任务。</p></div></div>
        <div id="completed-list"></div>
      </section>
      <details class="completed-fold">
        <summary>已取消 ${cancelled.length} 项</summary>
        <div id="cancelled-list"></div>
      </details>`;
      const options = { today: today(), onAction, onEdit, onError, resourceCounts };
      const completedList = root.querySelector('#completed-list');
      if (completed.length === 0) {
        completedList.innerHTML = `<div class="empty-state">
          <p class="empty-state__title">还没有已完成任务</p>
          <p class="empty-state__text">点任务行左侧的圆圈即可完成，完成记录会按实际完成日期出现在这里。</p>
        </div>`;
      } else {
        renderTaskList(completedList, completed, options);
      }
      renderTaskList(root.querySelector('#cancelled-list'), cancelled, {
        ...options,
        emptyMessage: '没有已取消任务。',
      });
    },
  };
}
