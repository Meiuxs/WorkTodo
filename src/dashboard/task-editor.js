import { escapeHtml } from '../shared/ui.js';
import { readRecurringForm } from './recurring-form.js';
import { createEditorAutosave } from './editor-autosave.js';

function field(form, name) {
  return form.elements.namedItem(name);
}

function valueOrNull(control) {
  const value = control.value.trim();
  return value.length === 0 ? null : value;
}

const SUBTASK_STATUS_LABELS = Object.freeze({
  todo: '待办',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
});

const SAVE_STATE_LABELS = Object.freeze({
  idle: '',
  dirty: '等待保存',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败，请重试',
  conflict: '发生冲突，请选择恢复方式',
});

function subtaskStatus(task) {
  if (task.trashedAt !== null) return '已删除';
  return SUBTASK_STATUS_LABELS[task.lifecycle] ?? '待办';
}

export function createTaskEditor({
  dialog,
  getCategories,
  getTags,
  onCreateTag,
  subtaskService,
  onCreate,
  onCreateRecurring = onCreate,
  onUpdate,
  onCopy,
  onReload,
  resourceService,
  openResourcePicker,
  onClose = () => {},
  onError = () => {},
  confirmDiscard = null,
}) {
  const form = dialog.querySelector('form');
  const title = dialog.querySelector('[data-editor-title]');
  const message = dialog.querySelector('[data-editor-message]');
  const conflict = dialog.querySelector('[data-editor-conflict]');
  const saveState = dialog.querySelector('[data-editor-save-state]');
  const submit = form.querySelector('[data-editor-submit]');
  const closeLabel = dialog.querySelector('[data-editor-close-label]');
  const category = field(form, 'categoryId');
  const tagOptions = dialog.querySelector('[data-tag-options]');
  const newTag = dialog.querySelector('#new-tag');
  const tagMessage = dialog.querySelector('[data-tag-message]');
  const subtaskList = dialog.querySelector('[data-subtask-list]');
  const subtaskTitle = dialog.querySelector('#subtask-title');
  const subtaskMessage = dialog.querySelector('[data-subtask-message]');
  const subtaskCreate = dialog.querySelector('[data-subtask-create]');
  let tags = [];
  let currentTask = null;
  let trigger = null;
  let anchorTaskId = null;
  let subtaskBusy = false;
  // 子任务行的点击处理是异步的；如果用户在资料/标签加载完成前按 Esc，
  // 旧请求不能在抽屉关闭后又把自己打开。每次打开或关闭都推进一个令牌，
  // 让迟到的打开请求安全失效。
  let openRequest = 0;
  // 新建任务仍需要确认放弃；已有任务通过自动保存不再有“取消修改”状态。
  let dirty = false;
  function markDirty() {
    dirty = true;
  }
  const recurring = field(form, 'recurring');
  const recurringFields = dialog.querySelector('[data-recurring-fields]');
  const resourceCount = dialog.querySelector('[data-resource-count]');
  const resourceList = dialog.querySelector('[data-resource-list]');
  const groupRows = new Map(
    [...dialog.querySelectorAll('[data-editor-group]')]
      .map((row) => [row.dataset.editorGroup, row]),
  );

  /* 行统一留在 DOM 里靠 hidden 控制：与既有的 resources.hidden / subtasks.hidden
     写法一致，也让"哪几行出现"集中在一处可读。 */
  function setGroupVisible(name, visible) {
    const row = groupRows.get(name);
    if (row !== undefined) row.hidden = !visible;
  }

  /* details[open] 是常驻 DOM 状态，抽屉关闭后仍留在元素上。
     不重置的话，用户展开过的组在下一次打开时还是展开的——展开六组就退回字段墙，
     正是这次改造要消灭的东西。所以每次打开都从头收起。 */
  function collapseGroups() {
    groupRows.forEach((row) => { row.open = false; });
  }

  const groupValues = new Map(
    [...dialog.querySelectorAll('[data-group-value]')]
      .map((node) => [node.dataset.groupValue, node]),
  );

  const starGlyph = dialog.querySelector('[data-star-glyph]');
  const starText = dialog.querySelector('[data-star-text]');

  /* 星标只靠 ☆/★ 字形表达状态时，读屏与色觉障碍用户无法判断，
     所以可访问名必须跟着状态走。 */
  function renderStar() {
    const checked = field(form, 'starred').checked;
    starGlyph.textContent = checked ? '★' : '☆';
    starText.textContent = checked ? '已标记为星标，点击取消' : '标记为星标';
  }

  const FREQUENCY_LABELS = Object.freeze({
    daily: '每天',
    weekdays: '每个工作日',
    weekly: '每周',
    monthly: '每月',
    yearly: '每年',
  });
  const UNIT_LABELS = Object.freeze({ day: '天', week: '周', month: '月' });

  function setGroupValue(name, text) {
    const node = groupValues.get(name);
    if (node !== undefined) node.textContent = text;
  }

  function recurringSummary() {
    if (!recurring.checked) return '不重复';
    const frequency = field(form, 'recurrenceFrequency').value;
    const interval = Number(field(form, 'recurrenceInterval').value);
    if (frequency === 'custom') {
      return `每 ${interval} ${UNIT_LABELS[field(form, 'recurrenceUnit').value] ?? '天'}`;
    }
    if (interval > 1) return `每 ${interval} ${frequency === 'weekly' ? '周' : '天'}`;
    return FREQUENCY_LABELS[frequency] ?? '不重复';
  }

  /* 收起不丢信息：摘要是用户在收起状态下判断这条任务现状的唯一依据，
     所以每次改动都要重算，而不是只在打开抽屉时算一次。 */
  function renderGroupSummaries() {
    setGroupValue('category', category.selectedOptions[0]?.textContent ?? '未归入列表');

    const tagCount = selectedTagIds().length;
    setGroupValue('tags', tagCount === 0 ? '未添加' : `${tagCount} 个`);

    setGroupValue('recurring', recurringSummary());

    const resourceTotal = resourceList.querySelectorAll('[data-resource-detach]').length;
    setGroupValue('resources', resourceTotal === 0 ? '无' : `${resourceTotal} 条`);

    const subtaskTotal = subtaskList.querySelectorAll('[data-subtask-id]').length;
    const subtaskDone = subtaskList.querySelectorAll('[data-subtask-id][data-subtask-done]').length;
    setGroupValue('subtasks', subtaskTotal === 0 ? '无' : `${subtaskDone}/${subtaskTotal} 完成`);

    const filled = field(form, 'description').value.trim().length > 0
      || field(form, 'startTime').value.length > 0
      || field(form, 'dueTime').value.length > 0;
    setGroupValue('more', filled ? '已填写' : '未填写');
  }

  async function renderResources() {
    if (currentTask === null || resourceService === undefined) {
      setGroupVisible('resources', false);
      resourceList.replaceChildren();
      resourceCount.textContent = '0';
      renderGroupSummaries();
      return;
    }
    const items = await resourceService.listForTask(currentTask.id);
    setGroupVisible('resources', true);
    resourceCount.textContent = String(items.length);
    resourceList.innerHTML = items.length === 0
      ? '<p class="empty">还没有关联资料。</p>'
      : items.map((resource) => `<div class="editor-resource-row"><span><strong>${escapeHtml(resource.title)}</strong><small>${resource.type === 'url' ? '网页链接' : resource.type === 'file' ? `本地文件 · ${escapeHtml(resource.fileName)}` : '文本片段'}</small></span><button type="button" data-resource-detach="${escapeHtml(resource.id)}">解除关联</button></div>`).join('');
    renderGroupSummaries();
  }

  function populateCategories(categories, selectedId) {
    category.innerHTML = '<option value="">未归入列表</option>'
      + categories.map((item) => `<option value="${item.id}">${item.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}</option>`).join('');
    category.value = selectedId ?? '';
    renderGroupSummaries();
  }

  function populateTags(items, selectedIds = []) {
    const selected = new Set(selectedIds);
    tagOptions.innerHTML = items.length === 0
      ? '<p class="empty">还没有标签。新建标签后可在这里勾选。</p>'
      : items.map((tag) => `<label class="tag-option"><input type="checkbox" name="tagIds" value="${escapeHtml(tag.id)}" ${selected.has(tag.id) ? 'checked' : ''}><span class="tag-option__name">${escapeHtml(tag.name)}</span></label>`).join('');
    renderGroupSummaries();
  }

  function selectedTagIds() {
    return [...tagOptions.querySelectorAll('input[name="tagIds"]:checked')].map((input) => input.value);
  }

  async function loadTags(selectedIds = []) {
    tags = await getTags();
    populateTags(tags, selectedIds);
  }

  async function renderSubtasks() {
    const canManage = currentTask !== null && currentTask.parentId === null;
    setGroupVisible('subtasks', canManage);
    if (!canManage) {
      subtaskList.replaceChildren();
      subtaskTitle.value = '';
      renderGroupSummaries();
      return;
    }
    const items = await subtaskService.list(currentTask.id);
    subtaskList.innerHTML = items.length === 0
      ? '<p class="empty">还没有子任务。</p>'
      : items.map((task) => {
        const status = subtaskStatus(task);
        const done = task.lifecycle === 'completed' ? ' data-subtask-done' : '';
        return `<button type="button" class="subtask-row" data-subtask-id="${escapeHtml(task.id)}"${done} aria-label="${escapeHtml(task.title)}，${status}">${escapeHtml(task.title)} <span>${status}</span></button>`;
      }).join('');
    renderGroupSummaries();
  }

  function readChanges() {
    return {
      title: field(form, 'title').value,
      scheduledDate: valueOrNull(field(form, 'scheduledDate')),
      priority: field(form, 'priority').value,
      categoryId: valueOrNull(category),
      tagIds: selectedTagIds(),
      description: field(form, 'description').value,
      startTime: valueOrNull(field(form, 'startTime')),
      dueTime: valueOrNull(field(form, 'dueTime')),
      starred: field(form, 'starred').checked,
    };
  }

  function renderSaveState({ state, error }) {
    if (saveState === null) return;
    saveState.textContent = SAVE_STATE_LABELS[state] ?? '';
    saveState.dataset.state = state;
    if (state === 'error' || state === 'conflict') {
      showMessage(errorMessage(error));
    } else if (state === 'saved' || state === 'idle') {
      showMessage('');
    }
    if (state === 'conflict') {
      conflict.hidden = false;
      conflict.scrollIntoView({ block: 'nearest' });
      requestAnimationFrame(() => dialog.querySelector('[data-editor-reload]')?.focus());
    }
  }

  async function saveTaskDraft(draft) {
    if (currentTask === null) return draft;
    const result = await onUpdate(currentTask.id, draft, currentTask.revision);
    currentTask = result.task;
    title.textContent = currentTask.title;
    return draft;
  }

  async function handleExternalChange(taskId) {
    if (currentTask === null || currentTask.id !== taskId) return;
    try {
      await autosave.flushOnExternalChange();
    } catch (error) {
      if (error?.name !== 'ConflictError') throw error;
    }
  }

  const autosave = createEditorAutosave({
    initial: {},
    save: saveTaskDraft,
    onStateChange: renderSaveState,
  });

  function updateRecurringVisibility() {
    recurringFields.hidden = !recurring.checked;
    dialog.querySelector('[data-recurrence-unit]').hidden = !recurring.checked
      || field(form, 'recurrenceFrequency').value !== 'custom';
  }

  function errorMessage(error) {
    if (error?.name === 'ValidationError') return error.message;
    return '任务没有保存。你的输入还在，请重试。';
  }

  function showMessage(text) {
    message.textContent = text;
  }

  function clearSectionMessages() {
    tagMessage.textContent = '';
    subtaskMessage.textContent = '';
  }

  async function openNew(defaults = {}) {
    const requestId = ++openRequest;
    clearSectionMessages();
    collapseGroups();
    autosave.cancel();
    currentTask = null;
    anchorTaskId = null;
    trigger = document.activeElement;
    title.textContent = '新增任务';
    closeLabel.textContent = '取消';
    submit.hidden = false;
    form.reset();
    dirty = false;
    recurring.checked = false;
    setGroupVisible('recurring', true);
    setGroupVisible('resources', false);
    setGroupVisible('subtasks', false);
    updateRecurringVisibility();
    const categories = await getCategories();
    if (requestId !== openRequest) return;
    populateCategories(categories, defaults.categoryId ?? null);
    await loadTags(defaults.tagIds ?? []);
    if (requestId !== openRequest) return;
    field(form, 'title').value = defaults.title ?? '';
    field(form, 'scheduledDate').value = defaults.scheduledDate ?? '';
    field(form, 'priority').value = defaults.priority ?? 'none';
    renderStar();
    autosave.reset(readChanges());
    conflict.hidden = true;
    showMessage('');
    await renderSubtasks();
    if (requestId !== openRequest) return;
    await renderResources();
    if (requestId !== openRequest) return;
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => field(form, 'title').focus());
  }

  async function openTask(task, sourceElement = document.activeElement) {
    const requestId = ++openRequest;
    clearSectionMessages();
    collapseGroups();
    autosave.cancel();
    if (!dialog.open) anchorTaskId = task.id;
    currentTask = task;
    trigger = sourceElement;
    title.textContent = task.title;
    closeLabel.textContent = '关闭';
    submit.hidden = true;
    form.reset();
    dirty = false;
    recurring.checked = false;
    setGroupVisible('recurring', false);
    updateRecurringVisibility();
    const categories = await getCategories();
    if (requestId !== openRequest) return;
    populateCategories(categories, task.categoryId);
    await loadTags(task.tagIds ?? []);
    if (requestId !== openRequest) return;
    field(form, 'title').value = task.title;
    field(form, 'scheduledDate').value = task.scheduledDate ?? '';
    field(form, 'priority').value = task.priority;
    field(form, 'description').value = task.description ?? '';
    field(form, 'startTime').value = task.startTime ?? '';
    field(form, 'dueTime').value = task.dueTime ?? '';
    field(form, 'starred').checked = Boolean(task.starred);
    renderStar();
    autosave.reset(readChanges());
    conflict.hidden = true;
    showMessage('');
    await renderSubtasks();
    if (requestId !== openRequest) return;
    await renderResources();
    if (requestId !== openRequest) return;
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => field(form, 'title').focus());
  }

  async function close({ force = false } = {}) {
    openRequest += 1;
    if (!force && currentTask !== null) {
      try {
        await autosave.flush();
      } catch {
        return false;
      }
    }
    if (!force && dirty && confirmDiscard !== null) {
      const discard = await confirmDiscard();
      if (!discard) return false;
    }
    autosave.cancel();
    dirty = false;
    clearSectionMessages();
    if (dialog.open) dialog.close();
    showMessage('');
    conflict.hidden = true;
    const previous = trigger;
    const taskId = anchorTaskId;
    trigger = null;
    anchorTaskId = null;
    await onClose();
    // 关闭后主列表可能先完成一次异步 patch，再由浏览器提交焦点变更；
    // 多等一帧再恢复，避免抽屉关闭瞬间把焦点留在已脱离 DOM 的旧行上。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (previous?.isConnected) {
        previous.focus();
        return;
      }
      const replacement = taskId === null
        ? document.querySelector('#quick-add-title')
        : document.querySelector(`[data-task-id="${CSS.escape(taskId)}"] [data-action="edit"]`);
      replacement?.focus();
    }));
    return true;
  }

  async function save() {
    if (currentTask !== null) {
      try {
        await autosave.flush();
        return true;
      } catch {
        return null;
      }
    }
    showMessage('');
    conflict.hidden = true;
    submit.disabled = true;
    try {
      const result = currentTask === null
        ? (readRecurringForm(form) === null
          ? await onCreate(readChanges())
          : await onCreateRecurring({ ...readChanges(), ...readRecurringForm(form) }))
        : await onUpdate(currentTask.id, readChanges(), currentTask.revision);
      dirty = false;
      await close();
      return result;
    } catch (error) {
      showMessage(errorMessage(error));
      if (error?.name === 'ConflictError') {
        conflict.hidden = false;
        // 面板在抽屉底部，收起改造后更容易落在视口外：用户只看到一行报错，
        // 不知道还有两个出口。先让它可见，再把焦点放到推荐动作上。
        conflict.scrollIntoView({ block: 'nearest' });
        dialog.querySelector('[data-editor-reload]').focus();
        return null;
      }
      const messageText = errorMessage(error);
      const focusField = messageText.includes('计划日期')
        ? field(form, 'scheduledDate')
        : messageText.includes('时间')
          ? field(form, 'startTime')
          : messageText.includes('优先级')
            ? field(form, 'priority')
            : field(form, 'title');
      focusField?.focus();
      return null;
    } finally {
      submit.disabled = false;
    }
  }

  async function createTag() {
    const selected = selectedTagIds();
    tagMessage.textContent = '';
    try {
      await onCreateTag(newTag.value);
      newTag.value = '';
      await loadTags(selected);
      newTag.focus();
    } catch (error) {
      tagMessage.textContent = error.message;
      newTag.focus();
    }
  }

  async function createSubtask() {
    if (currentTask === null || subtaskBusy) return;
    const taskId = currentTask.id;
    subtaskBusy = true;
    subtaskCreate.disabled = true;
    subtaskMessage.textContent = '';
    try {
      await subtaskService.createSubtask(taskId, { title: subtaskTitle.value });
      subtaskTitle.value = '';
      await renderSubtasks();
      subtaskTitle.focus();
    } catch (error) {
      subtaskMessage.textContent = error.message;
      subtaskTitle.focus();
    } finally {
      subtaskBusy = false;
      subtaskCreate.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });
  form.addEventListener('input', () => {
    if (currentTask === null) markDirty();
    else autosave.update(readChanges());
    renderGroupSummaries();
  });
  form.addEventListener('change', () => {
    if (currentTask === null) markDirty();
    else autosave.update(readChanges());
    renderGroupSummaries();
    renderStar();
  });
  dialog.querySelectorAll('[data-editor-close]').forEach((button) => {
    button.addEventListener('click', () => {
      close().catch(() => {});
    });
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close().catch(() => {});
  });
  // 原生日期/时间选择器贴着输入框弹出，字段靠近抽屉底部时浮层会向上翻转盖住上面的内容。
  // 聚焦时把该字段滚到视口中段，给原生浮层留出向下展开的空间（浮层本身不可用 CSS 定位）。
  dialog.addEventListener('focusin', (event) => {
    const control = event.target;
    if (control instanceof HTMLElement && control.matches('input[type="time"], input[type="date"]')) {
      control.scrollIntoView({ block: 'center' });
    }
  });
  dialog.querySelector('[data-editor-copy]').addEventListener('click', () => {
    void (async () => {
      if (currentTask === null) return;
      await onCopy(currentTask.id, readChanges());
      await close({ force: true });
    })().catch((error) => {
      showMessage(errorMessage(error));
      void Promise.resolve(onError(error)).catch(() => {});
    });
  });
  dialog.querySelector('[data-editor-reload]').addEventListener('click', () => {
    void (async () => {
      if (currentTask === null) return;
      const latest = await onReload(currentTask.id);
      await openTask(latest, trigger);
    })().catch((error) => {
      showMessage(errorMessage(error));
      void Promise.resolve(onError(error)).catch(() => {});
    });
  });
  dialog.querySelector('[data-create-tag]').addEventListener('click', createTag);
  newTag.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    createTag();
  });
  subtaskCreate.addEventListener('click', createSubtask);
  subtaskTitle.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    createSubtask();
  });
  recurring.addEventListener('change', updateRecurringVisibility);
  field(form, 'recurrenceFrequency').addEventListener('change', updateRecurringVisibility);
  subtaskList.addEventListener('click', async (event) => {
    const row = event.target.closest('[data-subtask-id]');
    if (row === null) return;
    const latest = await onReload(row.dataset.subtaskId);
    await openTask(latest, trigger);
  });
  dialog.querySelector('[data-resource-add]').addEventListener('click', async (event) => {
    if (currentTask === null || openResourcePicker === undefined) return;
    await openResourcePicker(currentTask.id, event.currentTarget);
    await renderResources();
  });
  resourceList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-resource-detach]');
    if (button === null || currentTask === null) return;
    await resourceService.detach(currentTask.id, button.dataset.resourceDetach);
    await renderResources();
  });

  return { openNew, openTask, close, handleExternalChange };
}
