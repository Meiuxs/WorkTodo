import { escapeHtml } from '../shared/ui.js';
import { readRecurringForm } from './recurring-form.js';

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
  confirmDiscard = null,
}) {
  const form = dialog.querySelector('form');
  const title = dialog.querySelector('[data-editor-title]');
  const message = dialog.querySelector('[data-editor-message]');
  const conflict = dialog.querySelector('[data-editor-conflict]');
  const category = field(form, 'categoryId');
  const tagOptions = dialog.querySelector('[data-tag-options]');
  const newTag = dialog.querySelector('#new-tag');
  const tagMessage = dialog.querySelector('[data-tag-message]');
  const subtasks = dialog.querySelector('[data-editor-subtasks]');
  const subtaskList = dialog.querySelector('[data-subtask-list]');
  const subtaskTitle = dialog.querySelector('#subtask-title');
  const subtaskMessage = dialog.querySelector('[data-subtask-message]');
  const subtaskCreate = dialog.querySelector('[data-subtask-create]');
  let tags = [];
  let currentTask = null;
  let trigger = null;
  let anchorTaskId = null;
  let subtaskBusy = false;
  // 有未保存修改时关闭抽屉要先确认，避免 Esc 或误点直接丢掉编辑内容。
  let dirty = false;
  function markDirty() {
    dirty = true;
  }
  const recurring = field(form, 'recurring');
  const recurringFields = dialog.querySelector('[data-recurring-fields]');
  const recurringPicker = dialog.querySelector('[data-recurring-picker]');
  const resources = dialog.querySelector('[data-editor-resources]');
  const resourceCount = dialog.querySelector('[data-resource-count]');
  const resourceList = dialog.querySelector('[data-resource-list]');

  async function renderResources() {
    if (currentTask === null || resourceService === undefined) {
      resources.hidden = true;
      resourceList.replaceChildren();
      resourceCount.textContent = '0';
      return;
    }
    const items = await resourceService.listForTask(currentTask.id);
    resources.hidden = false;
    resourceCount.textContent = String(items.length);
    resourceList.innerHTML = items.length === 0
      ? '<p class="muted">还没有关联资料。</p>'
      : items.map((resource) => `<div class="editor-resource-row"><span><strong>${escapeHtml(resource.title)}</strong><small>${resource.type === 'url' ? '网页链接' : resource.type === 'file' ? `本地文件 · ${escapeHtml(resource.fileName)}` : '文本片段'}</small></span><button type="button" data-resource-detach="${escapeHtml(resource.id)}">解除关联</button></div>`).join('');
  }

  function populateCategories(categories, selectedId) {
    category.innerHTML = '<option value="">未归入列表</option>'
      + categories.map((item) => `<option value="${item.id}">${item.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}</option>`).join('');
    category.value = selectedId ?? '';
  }

  function populateTags(items, selectedIds = []) {
    const selected = new Set(selectedIds);
    tagOptions.innerHTML = items.length === 0
      ? '<p class="muted">尚未创建标签。</p>'
      : items.map((tag) => `<label class="tag-option"><input type="checkbox" name="tagIds" value="${escapeHtml(tag.id)}" ${selected.has(tag.id) ? 'checked' : ''}> ${escapeHtml(tag.name)}</label>`).join('');
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
    subtasks.hidden = !canManage;
    if (!canManage) {
      subtaskList.replaceChildren();
      subtaskTitle.value = '';
      return;
    }
    const items = await subtaskService.list(currentTask.id);
    subtaskList.innerHTML = items.length === 0
      ? '<p class="empty">还没有子任务。</p>'
      : items.map((task) => {
        const status = subtaskStatus(task);
        return `<button type="button" class="subtask-row" data-subtask-id="${escapeHtml(task.id)}" aria-label="${escapeHtml(task.title)}，${status}">${escapeHtml(task.title)} <span>${status}</span></button>`;
      }).join('');
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
    clearSectionMessages();
    currentTask = null;
    anchorTaskId = null;
    trigger = document.activeElement;
    title.textContent = '新增任务';
    form.reset();
    dirty = false;
    recurring.checked = false;
    recurringPicker.hidden = false;
    updateRecurringVisibility();
    populateCategories(await getCategories(), defaults.categoryId ?? null);
    await loadTags(defaults.tagIds ?? []);
    field(form, 'title').value = defaults.title ?? '';
    field(form, 'scheduledDate').value = defaults.scheduledDate ?? '';
    field(form, 'priority').value = defaults.priority ?? 'none';
    conflict.hidden = true;
    showMessage('');
    await renderSubtasks();
    await renderResources();
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => field(form, 'title').focus());
  }

  async function openTask(task, sourceElement = document.activeElement) {
    clearSectionMessages();
    if (!dialog.open) anchorTaskId = task.id;
    currentTask = task;
    trigger = sourceElement;
    title.textContent = task.title;
    form.reset();
    dirty = false;
    recurring.checked = false;
    recurringPicker.hidden = true;
    updateRecurringVisibility();
    populateCategories(await getCategories(), task.categoryId);
    await loadTags(task.tagIds ?? []);
    field(form, 'title').value = task.title;
    field(form, 'scheduledDate').value = task.scheduledDate ?? '';
    field(form, 'priority').value = task.priority;
    field(form, 'description').value = task.description ?? '';
    field(form, 'startTime').value = task.startTime ?? '';
    field(form, 'dueTime').value = task.dueTime ?? '';
    field(form, 'starred').checked = Boolean(task.starred);
    conflict.hidden = true;
    showMessage('');
    await renderSubtasks();
    await renderResources();
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => field(form, 'title').focus());
  }

  async function close({ force = false } = {}) {
    if (!force && dirty && confirmDiscard !== null) {
      const discard = await confirmDiscard();
      if (!discard) return false;
    }
    dirty = false;
    clearSectionMessages();
    if (dialog.open) dialog.close();
    showMessage('');
    conflict.hidden = true;
    const previous = trigger;
    const taskId = anchorTaskId;
    trigger = null;
    anchorTaskId = null;
    onClose();
    requestAnimationFrame(() => {
      if (previous?.isConnected) {
        previous.focus();
        return;
      }
      const replacement = taskId === null
        ? document.querySelector('#quick-add-title')
        : document.querySelector(`[data-task-id="${CSS.escape(taskId)}"] [data-action="edit"]`);
      replacement?.focus();
    });
    return true;
  }

  async function save() {
    showMessage('');
    conflict.hidden = true;
    const submit = form.querySelector('[type="submit"]');
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
      if (error?.name === 'ConflictError') conflict.hidden = false;
      field(form, 'title').focus();
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
  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);
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
  dialog.querySelector('[data-editor-copy]').addEventListener('click', async () => {
    if (currentTask === null) return;
    await onCopy(currentTask.id);
    await close({ force: true });
  });
  dialog.querySelector('[data-editor-reload]').addEventListener('click', async () => {
    if (currentTask === null) return;
    const latest = await onReload(currentTask.id);
    await openTask(latest, trigger);
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

  return { openNew, openTask, close };
}
