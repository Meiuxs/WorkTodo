import { renderTaskList, renderTaskRow, arrangeSubtasks, emptyStateMarkup } from '../task-list.js';
import { patchTaskContainers } from '../list-patch.js';

export function createCompletedView({ root, query, tagService, today, onAction, onEdit, onError, getResourceCounts }) {
  function completedEmpty() {
    return emptyStateMarkup({
      title: '还没有已完成任务',
      text: '点任务行左侧的圆圈即可完成，完成记录会按实际完成日期出现在这里。',
    });
  }

  async function loadData(signal) {
    const [completed, cancelled, tags] = await Promise.all([
      query.completed(),
      query.cancelled(),
      tagService.list(),
    ]);
    if (signal?.aborted) return null;
    return { completed, cancelled, tags };
  }

  /* 已完成与已取消两个列表各自把子任务归位到父行下；合并 childrenByParent 供共享的 renderRow 使用。 */
  async function arrange(completed, cancelled) {
    const [completedArr, cancelledArr] = await Promise.all([
      arrangeSubtasks(query, completed),
      arrangeSubtasks(query, cancelled),
    ]);
    return {
      completedTop: completedArr.topLevel,
      cancelledTop: cancelledArr.topLevel,
      childrenByParent: new Map([...completedArr.childrenByParent, ...cancelledArr.childrenByParent]),
    };
  }

  return {
    async render(signal) {
      const data = await loadData(signal);
      if (data === null) return;
      const { completed, cancelled, tags } = data;
      const { completedTop, cancelledTop, childrenByParent } = await arrange(completed, cancelled);
      const resourceCounts = await getResourceCounts?.(completedTop) ?? new Map();
      root.innerHTML = `<section class="view-section" aria-labelledby="completed-heading">
        <div class="section-heading"><div><h2 id="completed-heading">已完成 · <span id="completed-count">${completedTop.length}</span></h2><p>按完成时间保留工作记录，可恢复为待办或复制为新任务。</p></div></div>
        <div id="completed-list"></div>
      </section>
      <details class="completed-fold">
        <summary id="cancelled-count">已取消 ${cancelledTop.length} 项</summary>
        <div id="cancelled-list"></div>
      </details>`;
      const options = { today: today(), tags, onAction, onEdit, onError, resourceCounts, childrenByParent };
      const completedList = root.querySelector('#completed-list');
      if (completedTop.length === 0) {
        completedList.innerHTML = completedEmpty();
      } else {
        renderTaskList(completedList, completedTop, options);
      }
      renderTaskList(root.querySelector('#cancelled-list'), cancelledTop, {
        ...options,
        emptyMessage: '没有已取消任务。',
      });
    },

    async patch(signal) {
      const data = await loadData(signal);
      if (data === null) return;
      const { completed, cancelled, tags } = data;
      const { completedTop, cancelledTop, childrenByParent } = await arrange(completed, cancelled);
      const resourceCounts = await getResourceCounts?.(completedTop) ?? new Map();
      if (signal?.aborted) return;
      const patched = patchTaskContainers(root, [
        {
          container: root.querySelector('#completed-list'),
          tasks: completedTop,
          // 恢复掉最后一个已完成项时补回页面级空状态，不留一片空白。
          onEmpty: () => { root.querySelector('#completed-list').innerHTML = completedEmpty(); },
        },
        { container: root.querySelector('#cancelled-list'), tasks: cancelledTop },
      ], {
        renderRow: (task) => renderTaskRow(task, { today: today(), tags, resourceCounts, childrenByParent }),
        collectCounts: () => ({
          '#completed-count': String(completedTop.length),
          '#cancelled-count': `已取消 ${cancelledTop.length} 项`,
        }),
      });
      if (patched === false) await this.render(signal);
    },
  };
}
