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
  let currentTask = null;
  let trigger = null;

  function populateCategories(categories, selectedId) {
    category.innerHTML = '<option value="">未分类</option>'
      + categories.map((item) => `<option value="${item.id}">${item.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}</option>`).join('');
    category.value = selectedId ?? '';
  }

  function readChanges() {
    return {
      title: field(form, 'title').value,
      scheduledDate: valueOrNull(field(form, 'scheduledDate')),
      priority: field(form, 'priority').value,
      categoryId: valueOrNull(category),
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
    field(form, 'title').value = defaults.title ?? '';
    field(form, 'scheduledDate').value = defaults.scheduledDate ?? '';
    field(form, 'priority').value = defaults.priority ?? 'none';
    conflict.hidden = true;
    showMessage('');
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => field(form, 'title').focus());
  }

  async function openTask(task, sourceElement = document.activeElement) {
    currentTask = task;
    trigger = sourceElement;
    title.textContent = task.title;
    form.reset();
    populateCategories(await getCategories(), task.categoryId);
    field(form, 'title').value = task.title;
    field(form, 'scheduledDate').value = task.scheduledDate ?? '';
    field(form, 'priority').value = task.priority;
    field(form, 'description').value = task.description ?? '';
    field(form, 'startTime').value = task.startTime ?? '';
    field(form, 'dueTime').value = task.dueTime ?? '';
    field(form, 'starred').checked = Boolean(task.starred);
    conflict.hidden = true;
    showMessage('');
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

  return { openNew, openTask, close };
}
