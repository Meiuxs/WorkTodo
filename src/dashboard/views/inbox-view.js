import { renderTaskList, renderTaskRow, arrangeSubtasks } from '../task-list.js';
import { patchTaskContainers } from '../list-patch.js';

export function createInboxView({ root, query, today, onAction, onEdit, onError, getResourceCounts }) {
  async function loadTasks(signal) {
    const tasks = await query.inbox();
    if (signal?.aborted) return null;
    return arrangeSubtasks(query, tasks);
  }

  return {
    async render(signal) {
      const arranged = await loadTasks(signal);
      if (arranged === null) return;
      const { topLevel, childrenByParent } = arranged;
      const resourceCounts = await getResourceCounts?.(topLevel) ?? new Map();
      root.innerHTML = `<section class="view-section" aria-labelledby="inbox-heading">
        <div class="section-heading">
          <div><h2 id="inbox-heading">收集箱 · <span id="inbox-count" data-view-count="inbox">${topLevel.length}</span></h2><p>先记录，再决定日期、优先级和列表。</p></div>
        </div>
        <div id="inbox-list"></div>
      </section>`;
      const list = root.querySelector('#inbox-list');
      if (topLevel.length === 0) {
        list.innerHTML = `<div class="empty-state">
          <p class="empty-state__title">收集箱是空的</p>
          <p class="empty-state__text">想到的事情先放进来，整理可以晚一点。</p>
          <button type="button" class="button-primary empty-state__action" data-focus-quick-add>记录一件事</button>
        </div>`;
      } else {
        renderTaskList(list, topLevel, {
          today: today(),
          onAction,
          onEdit,
          onError,
          resourceCounts,
          childrenByParent,
        });
      }
      root.querySelector('[data-focus-quick-add]')?.addEventListener('click', () => {
        document.querySelector('#quick-add-title')?.focus();
      });
    },

    async patch(signal) {
      const arranged = await loadTasks(signal);
      if (arranged === null) return;
      const { topLevel, childrenByParent } = arranged;
      const resourceCounts = await getResourceCounts?.(topLevel) ?? new Map();
      if (signal?.aborted) return;
      const patched = patchTaskContainers(root, [
        { container: root.querySelector('#inbox-list'), tasks: topLevel },
      ], {
        renderRow: (task) => renderTaskRow(task, { today: today(), resourceCounts, childrenByParent }),
        collectCounts: () => ({ '#inbox-count': String(topLevel.length) }),
      });
      if (patched === false) await this.render(signal);
    },
  };
}
