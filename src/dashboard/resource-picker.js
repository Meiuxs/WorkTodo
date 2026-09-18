import { escapeHtml } from '../shared/ui.js';

export function createResourcePicker({ dialog, resourceService, onChanged, onError }) {
  const form = dialog.querySelector('[data-resource-form]');
  const type = dialog.querySelector('[data-resource-type]');
  const title = dialog.querySelector('[data-resource-title]');
  const url = dialog.querySelector('[data-resource-url]');
  const content = dialog.querySelector('[data-resource-content]');
  const file = dialog.querySelector('[data-resource-file]');
  const note = dialog.querySelector('[data-resource-note]');
  const saveCopy = dialog.querySelector('[data-resource-save-copy]');
  const message = dialog.querySelector('[data-resource-message]');
  const existing = dialog.querySelector('[data-resource-existing]');
  const existingList = dialog.querySelector('[data-resource-existing-list]');
  let taskId = null;
  let trigger = null;
  let resolveOpen = null;

  function updateTypeFields() {
    const isUrl = type.value === 'url';
    const isSnippet = type.value === 'snippet';
    const isFile = type.value === 'file';
    dialog.querySelector('[data-resource-url-field]').hidden = !isUrl;
    dialog.querySelector('[data-resource-snippet-field]').hidden = !isSnippet;
    dialog.querySelector('[data-resource-file-field]').hidden = !isFile;
    dialog.querySelector('[data-resource-copy-field]').hidden = !isFile;
    url.required = isUrl;
    content.required = isSnippet;
    file.required = isFile;
  }

  async function renderExisting() {
    const resources = await resourceService.list();
    const attached = new Set((await resourceService.listForTask(taskId)).map((resource) => resource.id));
    const available = resources.filter((resource) => !attached.has(resource.id));
    existing.hidden = available.length === 0;
    existingList.innerHTML = available.map((resource) => `<button type="button" class="resource-existing-row" data-resource-existing-id="${escapeHtml(resource.id)}">${escapeHtml(resource.title)} <span>${resource.type === 'url' ? '网页链接' : resource.type === 'file' ? '本地文件' : '文本片段'}</span></button>`).join('');
  }

  function reset() {
    form.reset();
    type.value = 'url';
    message.textContent = '';
    updateTypeFields();
  }

  async function openForTask(nextTaskId, source = document.activeElement) {
    taskId = nextTaskId;
    trigger = source;
    reset();
    await renderExisting();
    dialog.showModal();
    requestAnimationFrame(() => title.focus());
    return new Promise((resolve) => { resolveOpen = resolve; });
  }

  function close() {
    if (dialog.open) dialog.close();
    resolveOpen?.();
    resolveOpen = null;
    requestAnimationFrame(() => trigger?.focus());
  }

  type.addEventListener('change', updateTypeFields);
  file.addEventListener('change', () => {
    if (file.files?.[0]?.name && title.value.trim().length === 0) title.value = file.files[0].name;
  });
  dialog.querySelector('[data-resource-cancel]').addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  existingList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-resource-existing-id]');
    if (button === null) return;
    try {
      await resourceService.attach(taskId, button.dataset.resourceExistingId);
      await onChanged?.();
      close();
    } catch (error) {
      onError(error);
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      let resource;
      if (type.value === 'url') resource = await resourceService.createUrl({ title: title.value, url: url.value, note: note.value });
      if (type.value === 'snippet') resource = await resourceService.createSnippet({ title: title.value, content: content.value, note: note.value });
      if (type.value === 'file') {
        const selected = file.files?.[0];
        if (selected === undefined) throw new Error('请选择本地文件');
        resource = await resourceService.createFile({ title: title.value, file: selected, note: note.value, saveCopy: saveCopy.checked });
      }
      await resourceService.attach(taskId, resource.id);
      await onChanged?.();
      close();
    } catch (error) {
      message.textContent = error?.message ?? '资料没有保存，请重试。';
    } finally {
      submit.disabled = false;
    }
  });
  updateTypeFields();

  return { openForTask };
}
