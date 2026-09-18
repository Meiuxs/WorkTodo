import { escapeHtml, runViewAction } from '../../shared/ui.js';

function typeLabel(type) {
  return type === 'url' ? '网页链接' : type === 'file' ? '本地文件' : '文本片段';
}

export function createResourcesView({ root, resourceService, query, onError }) {
  let text = '';
  let type = 'all';
  let renderVersion = 0;

  return {
    async render(signal) {
      const version = ++renderVersion;
      const resources = await resourceService.list({ text, type: type === 'all' ? null : type });
      const tasks = await query.all();
      const relationCounts = new Map(await Promise.all(resources.map(async (resource) => [resource.id, (await resourceService.listTaskIds(resource.id)).length])));
      if (signal?.aborted || version !== renderVersion) return;
      root.innerHTML = `<section class="view-section" aria-labelledby="resources-heading">
        <div class="section-heading"><div><h2 id="resources-heading">资料收集箱 · ${resources.length}</h2><p>先保存上下文，再决定它属于哪个任务。</p></div><button type="button" class="button-primary" data-resource-create>添加资料</button></div>
        <div class="resource-toolbar"><label class="filter-search">搜索资料<input type="search" data-resource-search value="${escapeHtml(text)}" placeholder="名称、链接、文件名或片段"></label><label>类型<select data-resource-filter><option value="all">全部资料</option><option value="url">网页链接</option><option value="file">本地文件</option><option value="snippet">文本片段</option></select></label></div>
        <div class="resources-list" role="list">${resources.length === 0 ? '<p class="empty">还没有资料。可以先保存一个链接、文件或文本片段。</p>' : resources.map((resource) => `<article class="resource-card" data-resource-id="${escapeHtml(resource.id)}" role="listitem"><div><p class="resource-card__type">${typeLabel(resource.type)}${resource.storageMode === 'copy' ? ' · 已保存副本' : ''}</p><h3>${escapeHtml(resource.title)}</h3><p class="resource-card__source">${escapeHtml(resource.url ?? resource.fileName ?? (resource.content ?? '').slice(0, 100))}</p>${resource.note ? `<p class="resource-card__note">${escapeHtml(resource.note)}</p>` : ''}</div><div class="resource-card__actions"><span>${relationCounts.get(resource.id) === 0 ? '未关联任务' : '已关联任务'}</span>${resource.type === 'file' && resource.storageMode === 'copy' ? '<button type="button" data-resource-download>下载副本</button>' : ''}<button type="button" data-resource-associate>关联任务</button><button type="button" data-resource-delete>删除</button></div></article>`).join('')}</div>
        <dialog class="modal" data-resource-create-dialog><form method="dialog" data-resource-create-form><h2>添加资料</h2><label class="field">资料类型<select data-resource-type><option value="url">网页链接</option><option value="snippet">文本片段</option><option value="file">本地文件</option></select></label><label class="field">资料名称<input data-resource-title maxlength="200" required></label><label class="field" data-url-field>网页链接<input data-resource-url type="url" placeholder="https://"></label><label class="field" data-snippet-field hidden>文本片段<textarea data-resource-content maxlength="20000"></textarea></label><label class="field" data-file-field hidden>本地文件<input data-resource-file type="file"></label><label class="check-field" data-copy-field hidden><input data-resource-copy type="checkbox"> 保存一份副本（单个文件不超过 20 MB）</label><label class="field">备注<textarea data-resource-note maxlength="2000" rows="2"></textarea></label><p class="form-message" data-resource-message role="alert"></p><div class="dialog-actions"><button type="button" data-resource-cancel>取消</button><button type="submit" class="button-primary">保存资料</button></div></form></dialog>
        <dialog class="modal" data-resource-associate-dialog><form method="dialog" data-resource-associate-form><h2>关联任务</h2><label class="field">选择任务<select data-resource-task-select>${tasks.filter((task) => task.trashedAt === null).map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}</option>`).join('')}</select></label><p class="form-message" data-associate-message role="alert"></p><div class="dialog-actions"><button type="button" data-associate-cancel>取消</button><button type="submit" class="button-primary">关联</button></div></form></dialog>
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
      const updateCreateType = () => {
        const selected = createForm.querySelector('[data-resource-type]').value;
        createForm.querySelector('[data-url-field]').hidden = selected !== 'url';
        createForm.querySelector('[data-snippet-field]').hidden = selected !== 'snippet';
        createForm.querySelector('[data-file-field]').hidden = selected !== 'file';
        createForm.querySelector('[data-copy-field]').hidden = selected !== 'file';
      };
      createForm.querySelector('[data-resource-type]').addEventListener('change', updateCreateType);
      root.querySelector('[data-resource-create]').addEventListener('click', () => { createDialog.showModal(); createForm.querySelector('[data-resource-title]').focus(); });
      createForm.querySelector('[data-resource-cancel]').addEventListener('click', () => createDialog.close());
      createForm.addEventListener('submit', (event) => {
        event.preventDefault();
        runViewAction(async () => {
          const selected = createForm.querySelector('[data-resource-type]').value;
          const input = {
            title: createForm.querySelector('[data-resource-title]').value,
            note: createForm.querySelector('[data-resource-note]').value,
          };
          if (selected === 'url') await resourceService.createUrl({ ...input, url: createForm.querySelector('[data-resource-url]').value });
          if (selected === 'snippet') await resourceService.createSnippet({ ...input, content: createForm.querySelector('[data-resource-content]').value });
          if (selected === 'file') {
            const file = createForm.querySelector('[data-resource-file]').files?.[0];
            if (file === undefined) throw new Error('请选择本地文件');
            await resourceService.createFile({ ...input, file, saveCopy: createForm.querySelector('[data-resource-copy]').checked });
          }
          createDialog.close();
          await this.render(signal);
        }, { signal, onError });
      });
      const associateDialog = root.querySelector('[data-resource-associate-dialog]');
      root.querySelectorAll('[data-resource-associate]').forEach((button) => button.addEventListener('click', () => {
        associateDialog.dataset.resourceId = button.closest('[data-resource-id]').dataset.resourceId;
        associateDialog.showModal();
      }));
      associateDialog.querySelector('[data-associate-cancel]').addEventListener('click', () => associateDialog.close());
      associateDialog.querySelector('[data-resource-associate-form]').addEventListener('submit', (event) => {
        event.preventDefault();
        runViewAction(async () => {
          await resourceService.attach(associateDialog.querySelector('[data-resource-task-select]').value, associateDialog.dataset.resourceId);
          associateDialog.close();
          await this.render(signal);
        }, { signal, onError });
      });
      root.querySelectorAll('[data-resource-delete]').forEach((button) => button.addEventListener('click', () => {
        runViewAction(async () => {
          const card = button.closest('[data-resource-id]');
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
      updateCreateType();
    },
  };
}
