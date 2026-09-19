import { renderTaskList } from '../task-list.js';

export function createInboxView({ root, query, today, onAction, onEdit, onError, getResourceCounts }) {
  return {
    async render(signal) {
      const tasks = await query.inbox();
      if (signal?.aborted) return;
      const resourceCounts = await getResourceCounts?.(tasks) ?? new Map();
      root.innerHTML = `<section class="view-section" aria-labelledby="inbox-heading">
        <div class="section-heading">
          <div><h2 id="inbox-heading">收集箱 · ${tasks.length}</h2><p>先记录，再决定日期、优先级和列表。</p></div>
        </div>
        <div id="inbox-list"></div>
      </section>`;
      const list = root.querySelector('#inbox-list');
      if (tasks.length === 0) {
        list.innerHTML = `<div class="empty-state">
          <p class="empty-state__title">收集箱是空的</p>
          <p class="empty-state__text">想到的事情先放进来，整理可以晚一点。</p>
          <button type="button" class="button-primary empty-state__action" data-focus-quick-add>记录一件事</button>
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
      root.querySelector('[data-focus-quick-add]')?.addEventListener('click', () => {
        document.querySelector('#quick-add-title')?.focus();
      });
    },
  };
}
