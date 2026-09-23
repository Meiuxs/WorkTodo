import { renderTaskList, emptyStateMarkup } from '../task-list.js';

export function createTrashView({ root, query, tagService, today, onAction, onEdit, onError, getResourceCounts }) {
  return {
    async render(signal) {
      const [tasks, tags] = await Promise.all([query.trashed(), tagService.list()]);
      if (signal?.aborted) return;
      const resourceCounts = await getResourceCounts?.(tasks) ?? new Map();

      root.innerHTML = `<section class="view-section" aria-labelledby="trash-heading">
        <div class="section-heading"><div><h2 id="trash-heading">回收站 · ${tasks.length}</h2></div></div>
        <div id="trash-list"></div>
      </section>`;
      const list = root.querySelector('#trash-list');
      if (tasks.length === 0) {
        list.innerHTML = emptyStateMarkup({
          title: '回收站空空如也',
          text: '移入回收站的任务会在这里等待恢复或永久删除。',
          art: 'bin',
        });
      } else {
        renderTaskList(list, tasks, {
          today: today(),
          tags,
          onAction,
          onEdit,
          onError,
          resourceCounts,
        });
      }
    },
  };
}
