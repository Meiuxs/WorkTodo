import { escapeHtml, runViewAction } from '../../shared/ui.js';
import { ValidationError } from '../../domain/errors.js';

function typeLabel(type) {
  return type === 'url' ? '网页链接' : type === 'file' ? '本地文件' : '文本片段';
}

function resourceSource(resource) {
  return resource.url ?? resource.fileName ?? (resource.content ?? '').slice(0, 100);
}

export function createResourcesView({ root, resourceService, query, onError, confirmAction }) {
  let text = '';
  let type = 'all';
  let renderVersion = 0;

  return {
    async render(signal) {
      const version = ++renderVersion;
      const resources = await resourceService.list({ text, type: type === 'all' ? null : type });
      const tasks = await query.all();
      const availableTasks = tasks.filter((task) => task.trashedAt === null);
      const relationCounts = new Map(await Promise.all(resources.map(async (resource) => [resource.id, (await resourceService.listTaskIds(resource.id)).length])));
      if (signal?.aborted || version !== renderVersion) return;
      root.innerHTML = `<section class="view-section" aria-labelledby="resources-heading">
        <div class="section-heading"><div><h2 id="resources-heading">资料收集箱 · ${resources.length}</h2><p>先保存上下文，再决定它属于哪个任务。</p></div><button type="button" class="button-primary" data-resource-create>添加资料</button></div>
        <div class="resource-toolbar"><label class="filter-search">搜索资料<input type="search" data-resource-search value="${escapeHtml(text)}" placeholder="名称、链接、文件名或片段"></label><label>类型<select data-resource-filter><option value="all">全部资料</option><option value="url">网页链接</option><option value="file">本地文件</option><option value="snippet">文本片段</option></select></label></div>
        <div class="resources-list"${resources.length === 0 ? '' : ' role="list"'}>${resources.length === 0 ? '<div class="empty-state"><p class="empty-state__title">还没有资料</p><p class="empty-state__text">可以先保存一个链接、文件或文本片段，之后再关联到任务。</p></div>' : resources.map((resource) => `<article class="resource-card" data-resource-id="${escapeHtml(resource.id)}" role="listitem"><div><p class="resource-card__type">${typeLabel(resource.type)}${resource.storageMode === 'copy' ? ' · 已保存副本' : ''}</p><h3><button type="button" class="resource-card__title" data-resource-edit aria-label="编辑资料：${escapeHtml(resource.title)}">${escapeHtml(resource.title)}</button></h3><p class="resource-card__source">${escapeHtml(resourceSource(resource))}</p>${resource.note ? `<p class="resource-card__note">${escapeHtml(resource.note)}</p>` : ''}</div><div class="resource-card__actions"><span>${relationCounts.get(resource.id) === 0 ? '未关联任务' : `已关联 ${relationCounts.get(resource.id)} 个任务`}</span>${resource.type === 'file' && resource.storageMode === 'copy' ? '<button type="button" data-resource-download>下载副本</button>' : ''}${resource.type === 'file' && resource.storageMode !== 'copy' ? '<button type="button" data-resource-relink>重新选择文件</button>' : ''}<button type="button" data-resource-associate>关联任务</button><button type="button" data-resource-delete>删除</button></div></article>`).join('')}</div>
        <dialog class="modal" data-resource-create-dialog><form method="dialog" data-resource-create-form><h2 data-resource-dialog-title>添加资料</h2><label class="field">资料类型<select data-resource-type><option value="url">网页链接</option><option value="snippet">文本片段</option><option value="file">本地文件</option></select></label><label class="field">资料名称<input data-resource-title maxlength="200" required></label><label class="field" data-url-field>网页链接<input data-resource-url type="url" placeholder="https://"></label><label class="field" data-snippet-field hidden>文本片段<textarea data-resource-content maxlength="20000"></textarea></label><label class="field" data-file-field hidden>本地文件<input data-resource-file type="file"></label><p class="field-hint" data-file-current hidden></p><label class="check-field" data-copy-field hidden><input data-resource-copy type="checkbox"><span>保存一份副本（单个文件不超过 20 MB）</span></label><label class="field">备注<textarea data-resource-note aria-label="资料备注" maxlength="2000" rows="2"></textarea></label><p class="form-message" data-resource-message role="alert"></p><div class="dialog-actions"><button type="button" data-resource-cancel>取消</button><button type="submit" class="button-primary" data-resource-submit>保存资料</button></div></form></dialog>
        <dialog class="modal" data-resource-associate-dialog><form method="dialog" data-resource-associate-form><h2>关联任务</h2>${availableTasks.length === 0 ? '<p class="empty">还没有可关联的任务。请先记录一个任务。</p>' : `<label class="field">选择任务<select data-resource-task-select>${availableTasks.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}</option>`).join('')}</select></label>`}<p class="form-message" data-associate-message role="alert"></p><div class="dialog-actions"><button type="button" data-associate-cancel>取消</button><button type="submit" class="button-primary" ${availableTasks.length === 0 ? 'disabled' : ''}>关联</button></div></form></dialog>
      </section>`;
      root.querySelector('[data-resource-filter]').value = type;
      root.querySelector('[data-resource-search]').addEventListener('input', (event) => {
        text = event.target.value;
        clearTimeout(root.__resourceSearchTimer);
        root.__resourceSearchTimer = setTimeout(() => runViewAction(() => this.render(signal), { signal, onError }), 150);
      });
      root.querySelector('[data-resource-filter]').addEventListener('change', (event) => {
        type = event.target.value;
        runViewAction(() => this.render(signal), { signal, onError });
      });
      const createDialog = root.querySelector('[data-resource-create-dialog]');
      const createForm = root.querySelector('[data-resource-create-form]');
      const resourceType = createForm.querySelector('[data-resource-type]');
      const resourceTitle = createForm.querySelector('[data-resource-title]');
      const resourceUrl = createForm.querySelector('[data-resource-url]');
      const resourceContent = createForm.querySelector('[data-resource-content]');
      const resourceFile = createForm.querySelector('[data-resource-file]');
      const resourceNote = createForm.querySelector('[data-resource-note]');
      const resourceDialogTitle = createForm.querySelector('[data-resource-dialog-title]');
      const resourceSubmit = createForm.querySelector('[data-resource-submit]');
      const fileCurrent = createForm.querySelector('[data-file-current]');
      let editingResource = null;
      const updateCreateType = () => {
        const selected = resourceType.value;
        createForm.querySelector('[data-url-field]').hidden = selected !== 'url';
        createForm.querySelector('[data-snippet-field]').hidden = selected !== 'snippet';
        createForm.querySelector('[data-file-field]').hidden = selected !== 'file' || editingResource !== null;
        createForm.querySelector('[data-copy-field]').hidden = selected !== 'file' || editingResource !== null;
        fileCurrent.hidden = !(editingResource !== null && selected === 'file');
      };
      let createTrigger = null;
      const resetResourceForm = () => {
        editingResource = null;
        createForm.reset();
        resourceType.disabled = false;
        resourceDialogTitle.textContent = '添加资料';
        resourceSubmit.textContent = '保存资料';
        fileCurrent.textContent = '';
        updateCreateType();
      };
      const openResourceForm = (resource, trigger) => {
        editingResource = resource;
        createTrigger = trigger;
        resourceType.value = resource.type;
        resourceType.disabled = true;
        resourceTitle.value = resource.title;
        resourceUrl.value = resource.url ?? '';
        resourceContent.value = resource.content ?? '';
        resourceNote.value = resource.note ?? '';
        resourceFile.value = '';
        resourceDialogTitle.textContent = '编辑资料';
        resourceSubmit.textContent = '保存修改';
        fileCurrent.textContent = resource.fileName ? `当前文件：${resource.fileName}。如需更换，请使用资料卡上的“重新选择文件”。` : '';
        updateCreateType();
        createDialog.showModal();
        resourceTitle.focus();
      };
      resourceType.addEventListener('change', updateCreateType);
      root.querySelector('[data-resource-create]').addEventListener('click', (event) => {
        resetResourceForm();
        createTrigger = event.currentTarget;
        createDialog.showModal();
        resourceTitle.focus();
      });
      createDialog.addEventListener('close', () => {
        createTrigger?.focus();
        createTrigger = null;
      });
      createForm.querySelector('[data-resource-cancel]').addEventListener('click', () => createDialog.close());
      root.querySelectorAll('[data-resource-edit]').forEach((button) => button.addEventListener('click', (event) => {
        runViewAction(async () => {
          const resource = await resourceService.get(button.closest('[data-resource-id]').dataset.resourceId);
          if (resource === undefined) throw new ValidationError('资料不存在，请刷新后重试。');
          openResourceForm(resource, event.currentTarget);
        }, { signal, onError });
      }));
      createForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const formMessage = createForm.querySelector('[data-resource-message]');
        formMessage.textContent = '';
        runViewAction(async () => {
          const selected = resourceType.value;
          const input = {
            title: resourceTitle.value,
            note: resourceNote.value,
          };
          try {
            if (editingResource !== null) {
              const changes = { ...input };
              if (selected === 'url') changes.url = resourceUrl.value;
              if (selected === 'snippet') changes.content = resourceContent.value;
              await resourceService.update(editingResource.id, changes, editingResource.revision);
            } else if (selected === 'url') {
              await resourceService.createUrl({ ...input, url: resourceUrl.value });
            } else if (selected === 'snippet') {
              await resourceService.createSnippet({ ...input, content: resourceContent.value });
            } else if (selected === 'file') {
              const file = resourceFile.files?.[0];
              if (file === undefined) throw new ValidationError('请选择本地文件');
              await resourceService.createFile({ ...input, file, saveCopy: createForm.querySelector('[data-resource-copy]').checked });
            }
          } catch (error) {
            // 校验错误留在表单里，只让真正意外的失败冒泡到全局提示。
            if (error?.name === 'ValidationError') {
              formMessage.textContent = error.message;
              return;
            }
            throw error;
          }
          createDialog.close();
          await this.render(signal);
        }, { signal, onError });
      });
      const associateDialog = root.querySelector('[data-resource-associate-dialog]');
      let associateTrigger = null;
      root.querySelectorAll('[data-resource-associate]').forEach((button) => button.addEventListener('click', (event) => {
        associateTrigger = event.currentTarget;
        associateDialog.dataset.resourceId = button.closest('[data-resource-id]').dataset.resourceId;
        associateDialog.showModal();
        associateDialog.querySelector('[data-resource-task-select]')?.focus();
      }));
      associateDialog.addEventListener('close', () => associateTrigger?.focus());
      associateDialog.querySelector('[data-associate-cancel]').addEventListener('click', () => associateDialog.close());
      associateDialog.querySelector('[data-resource-associate-form]').addEventListener('submit', (event) => {
        event.preventDefault();
        const formMessage = associateDialog.querySelector('[data-associate-message]');
        formMessage.textContent = '';
        runViewAction(async () => {
          try {
            await resourceService.attach(associateDialog.querySelector('[data-resource-task-select]').value, associateDialog.dataset.resourceId);
          } catch (error) {
            if (error?.name === 'ValidationError') {
              formMessage.textContent = error.message;
              return;
            }
            throw error;
          }
          associateDialog.close();
          await this.render(signal);
        }, { signal, onError });
      });
      root.querySelectorAll('[data-resource-delete]').forEach((button) => button.addEventListener('click', () => {
        runViewAction(async () => {
          const card = button.closest('[data-resource-id]');
          const confirmed = await confirmAction({
            title: '删除资料？',
            message: '已保存的文件副本也会被删除，且无法恢复。',
            confirmLabel: '删除资料',
          });
          if (!confirmed) return;
          await resourceService.remove(card.dataset.resourceId, { force: false });
          await this.render(signal);
        }, { signal, onError });
      }));
      root.querySelectorAll('[data-resource-download]').forEach((button) => button.addEventListener('click', () => {
        runViewAction(async () => {
          const resource = await resourceService.get(button.closest('[data-resource-id]').dataset.resourceId);
          if (!(resource?.blob instanceof Blob)) throw new Error('文件副本不可用，请重新选择文件。');
          const url = URL.createObjectURL(resource.blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = resource.fileName;
          link.click();
          URL.revokeObjectURL(url);
        }, { signal, onError });
      }));
      root.querySelectorAll('[data-resource-relink]').forEach((button) => button.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (file === undefined) return;
          runViewAction(async () => {
            await resourceService.replaceFile(button.closest('[data-resource-id]').dataset.resourceId, file, false);
            await this.render(signal);
          }, { signal, onError });
        }, { once: true });
        input.click();
      }));
      updateCreateType();
    },
  };
}
