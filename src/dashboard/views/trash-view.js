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
      renderTaskList(root.querySelector('#trash-list'), tasks, {
        today: today(),
        onAction,
        onEdit,
        onError,
        resourceCounts,
        emptyMessage: '回收站为空，删除的任务会在这里等待处理。',
      });
    },
  };
}
