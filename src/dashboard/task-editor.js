import { escapeHtml } from '../shared/ui.js';

function field(form, name) {
  return form.elements.namedItem(name);
}

function valueOrNull(control) {
  const value = control.value.trim();
  return value.length === 0 ? null : value;
}

export function createTaskEditor({
  dialog,
  getCategories,
  getTags,
  onCreateTag,
  subtaskService,
  onCreate,
  onUpdate,
  onCopy,
  onReload,
  onClose = () => {},
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
  let tags = [];
  let currentTask = null;
  let trigger = null;

  function populateCategories(categories, selectedId) {
    category.innerHTML = '<option value="">未分类</option>'
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
      : items.map((task) => `<button type="button" class="subtask-row" data-subtask-id="${escapeHtml(task.id)}">${escapeHtml(task.title)} <span>${task.lifecycle === 'completed' ? '已完成' : '待办'}</span></button>`).join('');
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

  function errorMessage(error) {
    if (error?.name === 'ValidationError') return error.message;
    return '任务没有保存。你的输入还在，请重试。';
  }

  function showMessage(text) {
    message.textContent = text;
  }

  async function openNew(defaults = {}) {
    currentTask = null;
    trigger = document.activeElement;
    title.textContent = '新增任务';
    form.reset();
    populateCategories(await getCategories(), defaults.categoryId ?? null);
    await loadTags(defaults.tagIds ?? []);
    field(form, 'title').value = defaults.title ?? '';
    field(form, 'scheduledDate').value = defaults.scheduledDate ?? '';
    field(form, 'priority').value = defaults.priority ?? 'none';
    conflict.hidden = true;
    showMessage('');
    await renderSubtasks();
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => field(form, 'title').focus());
  }

  async function openTask(task, sourceElement = document.activeElement) {
    currentTask = task;
    trigger = sourceElement;
    title.textContent = task.title;
    form.reset();
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
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => field(form, 'title').focus());
  }

  function close() {
    if (dialog.open) dialog.close();
    showMessage('');
    conflict.hidden = true;
    const previous = trigger;
    const taskId = currentTask?.id ?? null;
    trigger = null;
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
  }

  async function save() {
    showMessage('');
    conflict.hidden = true;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = currentTask === null
        ? await onCreate(readChanges())
        : await onUpdate(currentTask.id, readChanges(), currentTask.revision);
      close();
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

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save();
  });
  dialog.querySelectorAll('[data-editor-close]').forEach((button) => {
    button.addEventListener('click', close);
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.querySelector('[data-editor-copy]').addEventListener('click', async () => {
    if (currentTask === null) return;
    await onCopy(currentTask.id);
    close();
  });
  dialog.querySelector('[data-editor-reload]').addEventListener('click', async () => {
    if (currentTask === null) return;
    const latest = await onReload(currentTask.id);
    await openTask(latest, trigger);
  });
  dialog.querySelector('[data-create-tag]').addEventListener('click', async () => {
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
  });
  dialog.querySelector('[data-subtask-create]').addEventListener('click', async () => {
    if (currentTask === null) return;
    subtaskMessage.textContent = '';
    try {
      await subtaskService.createSubtask(currentTask.id, { title: subtaskTitle.value });
      subtaskTitle.value = '';
      await renderSubtasks();
      subtaskTitle.focus();
    } catch (error) {
      subtaskMessage.textContent = error.message;
      subtaskTitle.focus();
    }
  });
  subtaskList.addEventListener('click', async (event) => {
    const row = event.target.closest('[data-subtask-id]');
    if (row === null) return;
    const latest = await onReload(row.dataset.subtaskId);
    await openTask(latest, trigger);
  });

  return { openNew, openTask, close };
}
