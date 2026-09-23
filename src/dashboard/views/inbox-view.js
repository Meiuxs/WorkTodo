import { renderTaskList, renderTaskRow, arrangeSubtasks, emptyStateMarkup } from '../task-list.js';
import { patchTaskContainers } from '../list-patch.js';

export function createInboxView({ root, query, tagService, today, onAction, onEdit, onError, getResourceCounts }) {
  function inboxEmpty() {
    return emptyStateMarkup({
      title: '收集箱是空的',
      text: '想到的事情先放进来，整理可以晚一点。',
      action: '记录一件事',
      art: 'tray',
    });
  }
  function bindEmptyStateActions() {
    root.querySelector('[data-focus-quick-add]')?.addEventListener('click', () => {
      document.querySelector('#quick-add-title')?.focus();
    });
  }

  async function loadTasks(signal) {
    const [tasks, tags] = await Promise.all([query.inbox(), tagService.list()]);
    if (signal?.aborted) return null;
    const arranged = await arrangeSubtasks(query, tasks);
    return { ...arranged, tags };
  }

  return {
    async render(signal) {
      const arranged = await loadTasks(signal);
      if (arranged === null) return;
      const { topLevel, childrenByParent, tags } = arranged;
      const resourceCounts = await getResourceCounts?.(topLevel) ?? new Map();
      root.innerHTML = `<section class="view-section" aria-labelledby="inbox-heading">
        <div class="section-heading">
          <div><h2 id="inbox-heading">收集箱 · <span id="inbox-count" data-view-count="inbox">${topLevel.length}</span></h2>${topLevel.length === 0 ? '' : '<p>先记录，再决定日期、优先级和列表。</p>'}</div>
        </div>
        <div id="inbox-list"></div>
      </section>`;
      const list = root.querySelector('#inbox-list');
      if (topLevel.length === 0) {
        list.innerHTML = inboxEmpty();
      } else {
        renderTaskList(list, topLevel, {
          today: today(),
          tags,
          onAction,
          onEdit,
          onError,
          resourceCounts,
          childrenByParent,
        });
      }
      bindEmptyStateActions();
    },

    async patch(signal) {
      const arranged = await loadTasks(signal);
      if (arranged === null) return;
      const { topLevel, childrenByParent, tags } = arranged;
      const resourceCounts = await getResourceCounts?.(topLevel) ?? new Map();
      if (signal?.aborted) return;
      const patched = patchTaskContainers(root, [
        {
          container: root.querySelector('#inbox-list'),
          tasks: topLevel,
          onEmpty: () => {
            root.querySelector('#inbox-list').innerHTML = inboxEmpty();
            bindEmptyStateActions();
          },
        },
      ], {
        renderRow: (task) => renderTaskRow(task, { today: today(), tags, resourceCounts, childrenByParent }),
        collectCounts: () => ({ '#inbox-count': String(topLevel.length) }),
      });
      if (patched === false) await this.render(signal);
    },
  };
}
