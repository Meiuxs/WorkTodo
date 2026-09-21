/* 任务行动作的原地更新：动作之后数据没有换页、没有新增缺失行时，
   只替换发生变化的任务行，保住滚动位置、键盘焦点和其他行展开中的菜单。
   协调算法按新顺序逐行对齐：位置没动的节点完全不碰，移动的行整体搬移，
   新增的行按位置插入，消失的行随对账移除；节点可以在受管容器之间迁移
   （例如完成后从“今天”挪进“已完成”折叠区）。
   任何超出能力范围的情况（列表结构变化、容器消失、出现看不到的行）
   都返回 false，由调用方回退到整页渲染。 */

/* 从当前持有该行的 nodeMap（id -> 节点）里摘掉映射并从 managed 除名；
   不删除 DOM 节点本身（是否重新插入由调用方决定）。 */
function detachNode(id, nodeMap, managed) {
  const node = nodeMap.get(id);
  nodeMap.delete(id);
  managed.delete(id);
  return node ?? null;
}

function makeRow(task, renderRow, list) {
  const template = document.createElement('div');
  template.innerHTML = renderRow(task);
  const row = template.firstElementChild;
  if (row === null) return null;
  list.set(task.id, row);
  return row;
}

function rowFromMarkup(markup, list, id) {
  const template = document.createElement('div');
  template.innerHTML = markup;
  const row = template.firstElementChild;
  if (row === null) return null;
  list.set(id, row);
  return row;
}

/* 更新已有行的外层属性与内容，但保留节点身份：协调器后续还要把这行
   从来源列表摘下并搬到目标列表，直接 replaceWith 会让来源游标失效。 */
function updateRowMarkup(row, markup, preserveMenuState = false) {
  const template = document.createElement('div');
  template.innerHTML = markup;
  const replacement = template.firstElementChild;
  if (replacement === null) return row;
  const wasOpen = preserveMenuState && row.querySelector('.task__more[open]') !== null;
  for (const attribute of [...row.attributes]) {
    if (!replacement.hasAttribute(attribute.name)) row.removeAttribute(attribute.name);
  }
  for (const attribute of replacement.attributes) {
    row.setAttribute(attribute.name, attribute.value);
  }
  row.replaceChildren(...[...replacement.childNodes].map((node) => node.cloneNode(true)));
  const details = row.querySelector('.task__more');
  if (details !== null && wasOpen) details.open = true;
  return row;
}

/* 行被替换时用户视角只是内容刷新：新行里的菜单若比旧行多开/少关，
   在插入前把展开态同步过去，避免“改完优先级菜单就收起”。 */
function carryMenuOpenState(oldRow, newRow) {
  if (oldRow === null || newRow === null) return;
  const wasOpen = oldRow.querySelector('.task__more[open]') !== null;
  const details = newRow.querySelector('.task__more');
  if (details !== null && details.open !== wasOpen) details.open = wasOpen;
}

function moveFocusToNeighbor(neighbor) {
  const target = neighbor?.querySelector('[data-action="edit"]');
  if (target !== null && target !== undefined) target.focus();
}

/* containers: [{ container, tasks, onEmpty }]；renderRow(task) 返回单行 markup。
   onEmpty 是可选的页面级空状态填充：行集归零时由视图补回空状态，
   保住引导文案与动作入口。 */
export function patchTaskContainers(root, containers, { renderRow, collectCounts } = {}) {
  if (root === null || root.isConnected === false) return false;
  const plans = [];
  const managed = new Map();
  for (const { container, tasks, onEmpty } of containers) {
    if (!(container instanceof HTMLElement)) return false;
    const list = container.querySelector(':scope > .task-list');
    if (list === null) {
      // 容器里还没有行（只有空状态占位）：
      // 新集合也为空时保持占位不动；有行时清掉占位、在游离列表里建行后整体挂入。
      if (tasks.length === 0) continue;
      // .empty-state 是页面级占位（今天/收集箱首屏）：清掉它走与 .empty 同一重建路径，
      // 否则会被当成"视图结构已变化"而回退整页渲染。
      const onlyEmptyPlaceholder = container.childElementCount === 0
        || (container.childElementCount === 1
          && container.firstElementChild.matches('.empty, .empty-state'));
      if (onlyEmptyPlaceholder !== false) {
        container.replaceChildren();
        const ghost = document.createElement('div');
        ghost.className = 'task-list';
        ghost.setAttribute('role', 'list');
        plans.push({ container, list: ghost, nodes: new Map(), tasks, detached: true });
        continue;
      }
      return false;
    }
    const nodes = new Map();
    for (const child of list.children) {
      const id = child instanceof HTMLElement ? child.dataset.taskId : undefined;
      if (id === undefined) return false;
      if (managed.has(id) || nodes.has(id)) return false;
      nodes.set(id, child);
      managed.set(id, { nodes, list });
    }
    if (tasks.length === 0) {
      // 满→空过渡：行数归零不是"没变化"。
      if (typeof onEmpty === 'function') {
        // 有页面级空状态的容器：就地清空行并补回空状态，
        // 否则用户完成最后一个任务后只剩一片空白，丢掉引导与动作入口。
        // 焦点兜底不用在这里处理：被删行断开后由下方的焦点块统一交给快速记录。
        if (container.childElementCount > 0) {
          while (list.firstElementChild !== null) {
            managed.delete(list.firstElementChild.dataset.taskId);
            list.firstElementChild.remove();
          }
          container.replaceChildren();
          onEmpty();
        }
        continue;
      }
      // 没有页面级空状态的容器（例如"已完成"折叠区）：撤销把行搬去别的列表后，
      // 这里仍要把清空后的行集交给 plans 循环，由游标统一移除残留孤行。
      if (list.childElementCount === 0) continue;
    }
    plans.push({ container, list, nodes, tasks });
  }
  // 出现了不属于任何受管容器的行（视图结构已变化）时不敢局部动手。
  for (const node of root.querySelectorAll('[data-task-id]')) {
    if (node instanceof HTMLElement && !managed.has(node.dataset.taskId)) return false;
  }

  const active = document.activeElement;
  const removedAncestor = active instanceof Element ? active.closest('[data-task-id]') : null;
  let focusFallback = null;
  for (const plan of plans) {
    let ref = plan.list.firstElementChild;
    for (const task of plan.tasks) {
      if (task.id === ref?.dataset.taskId) {
        // 行还在原位：内容没变就完全不碰节点（保住焦点/锚点），变了才替换并保住展开中的菜单。
        // 用浏览器序列化后的 outerHTML 对比（同为节点→字符串，避免作者字符串与归一化结果不一致）。
        if (renderRow !== undefined) {
          const replacement = rowFromMarkup(renderRow(task), plan.nodes, task.id);
          if (replacement !== null && replacement.outerHTML !== ref.outerHTML) {
            carryMenuOpenState(ref, replacement);
            ref.replaceWith(replacement);
            managed.set(task.id, { nodes: plan.nodes, list: plan.list });
            ref = replacement.nextElementSibling;
            continue;
          }
        }
        // 原位且内容未变（或无法重绘）：从待安置集合除名，但不动 DOM 节点。
        plan.nodes.delete(task.id);
        managed.delete(task.id);
        ref = ref.nextElementSibling;
        continue;
      }
      const holder = managed.get(task.id);
      const reused = holder ? detachNode(task.id, holder.nodes, managed) : null;
      let row = reused ?? makeRow(task, renderRow, plan.nodes);
      if (row === null) continue;
      // 跨列表移动时不能直接复用旧行：任务状态、圆环动作和菜单内容
      // 可能已经变化（例如“已完成”恢复到“今天”后必须重新变成“待办”）。
      // 同列表重排也按最新任务重绘，避免复用带着旧 revision/状态的 DOM。
      if (reused !== null && renderRow !== undefined) {
        // 菜单展开态只对同一列表内的行更新保留；跨列表移动后必须从收起状态开始，
        // 否则从“已完成”恢复到“今天”会把原菜单一起带过去。
        row = updateRowMarkup(reused, renderRow(task), holder?.list === plan.list);
      }
      // 新建的行也要登记，后续容器才能把它识别成“可迁移的已有节点”而不是孤儿。
      managed.set(task.id, { nodes: plan.nodes, list: plan.list });
      if (ref === null) plan.list.append(row);
      else plan.list.insertBefore(row, ref);
    }
    // 游标之后的残留节点是已经消失的行（完成移入折叠区、进回收站等），移除前摘除映射。
    while (ref !== null) {
      const next = ref.nextElementSibling;
      if (removedAncestor !== null && focusFallback === null && ref === removedAncestor) {
        focusFallback = next ?? ref.previousElementSibling;
      }
      managed.delete(ref.dataset.taskId);
      ref.remove();
      ref = next;
    }
    if (plan.detached === true && plan.list.childElementCount > 0) {
      plan.container.append(plan.list);
    }
  }
  if (typeof collectCounts === 'function') {
    for (const [selector, value] of Object.entries(collectCounts(plans))) {
      const target = root.querySelector(selector);
      if (target !== null) target.textContent = value;
    }
  }
  if (removedAncestor !== null && !removedAncestor.isConnected) {
    // 满→空后没有了"相邻行"：把焦点交给空状态要引导去的地方（快速记录），
    // 不让它随被删节点掉回 body。
    if (focusFallback === null) document.querySelector('#quick-add-title')?.focus();
    else moveFocusToNeighbor(focusFallback);
  }
  return true;
}
