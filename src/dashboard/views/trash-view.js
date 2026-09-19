import { renderTaskList } from '../task-list.js';

export function createTrashView({ root, query, today, onAction, onEdit, onError, getResourceCounts }) {
  return {
    async render(signal) {
      const tasks = await query.trashed();
      if (signal?.aborted) return;
      const resourceCounts = await getResourceCounts?.(tasks) ?? new Map();

      root.innerHTML = `<section class="view-section" aria-labelledby="trash-heading">
        <div class="section-heading"><div><h2 id="trash-heading">回收站 · ${tasks.length}</h2></div></div>
        <div id="trash-list"></div>
      </section>`;
      const list = root.querySelector('#trash-list');
      if (tasks.length === 0) {
        list.innerHTML = `<div class="empty-state">
          <p class="empty-state__title">回收站是空的</p>
          <p class="empty-state__text">移入回收站的任务会在这里等待处理或永久删除。</p>
        </div>`;
      } else {
        renderTaskList(list, tasks, {
          today: today(),
          onAction,
          onEdit,
          onError,
          resourceCounts,
        });
      }
    },
  };
}
