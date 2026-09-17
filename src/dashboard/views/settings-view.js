import { escapeHtml, runViewAction } from '../../shared/ui.js';

const INITIAL_STATE = Object.freeze({
  kind: 'idle',
  canConfirm: false,
  message: '选择一个 JSON 备份文件开始校验。',
  preview: null,
  text: null,
});

function clone(value) {
  return structuredClone(value);
}

export class DataManagementController {
  #backupService;
  #state = clone(INITIAL_STATE);

  constructor({ backupService }) {
    this.#backupService = backupService;
  }

  get state() {
    return clone(this.#state);
  }

  async selectFile(file) {
    this.#state = {
      kind: 'validating',
      canConfirm: false,
      message: '正在校验备份文件…',
      preview: null,
      text: null,
    };
    try {
      const text = await file.text();
      const preview = await this.#backupService.previewImport(text);
      this.#state = {
        kind: 'preview',
        canConfirm: true,
        message: `可以导入 ${preview.taskCount} 个任务、${preview.categoryCount} 个分类和 ${preview.eventCount} 条事件。`,
        preview,
        text,
      };
      return this.#state;
    } catch (error) {
      this.#state = {
        kind: 'error',
        canConfirm: false,
        message: error?.name === 'ValidationError' ? error.message : '备份文件无法读取，请选择有效的 WorkTodo JSON 文件。',
        preview: null,
        text: null,
      };
      return this.#state;
    }
  }

  async confirm(mode) {
    if (this.#state.kind !== 'preview' || !this.#state.canConfirm) {
      throw new Error('当前没有可确认的导入预览');
    }
    const text = this.#state.text;
    this.#state = {
      ...this.#state,
      kind: 'importing',
      canConfirm: false,
      message: '正在导入并保存本地数据…',
    };
    try {
      const preview = await this.#backupService.importBackup(text, mode);
      this.#state = {
        kind: 'result',
        canConfirm: false,
        message: `导入完成：${preview.taskCount} 个任务，${preview.conflicts.length} 项冲突已按较新版本处理。`,
        preview,
        text: null,
      };
      return this.#state;
    } catch (error) {
      this.#state = {
        kind: 'error',
        canConfirm: false,
        message: error?.name === 'ValidationError' ? error.message : '导入没有完成，本机原有数据保持不变。',
        preview: null,
        text: null,
      };
      return this.#state;
    }
  }

  reset() {
    this.#state = clone(INITIAL_STATE);
  }
}

function categoryOptions(categories, selectedId = '') {
  return '<option value="">转为未分类</option>' + categories
    .filter((item) => item.id !== selectedId)
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('');
}

function categoryRows(categories) {
  if (categories.length === 0) {
    return '<p class="empty">还没有分类。创建后可在任务编辑器中分配。</p>';
  }
  return categories.map((item) => `<div class="category-row" data-category-id="${escapeHtml(item.id)}">
    <label class="sr-only" for="category-${escapeHtml(item.id)}">分类名称</label>
    <input id="category-${escapeHtml(item.id)}" value="${escapeHtml(item.name)}" maxlength="100">
    <button type="button" data-category-action="rename">保存名称</button>
    <button type="button" data-category-action="delete">删除分类</button>
  </div>`).join('');
}

export function createSettingsView({
  root,
  taskService,
  tagService,
  query,
  csvService,
  settingsRepository,
  backupService,
  onDataChanged = async () => {},
  onError = () => {},
}) {
  const dataController = new DataManagementController({ backupService });
  let categories = [];

  function dataStateMarkup(state) {
    const preview = state.preview;
    return `<div class="data-state data-state--${state.kind}" role="status">
      <p>${escapeHtml(state.message)}</p>
      ${state.kind === 'preview' ? `<p class="data-preview">任务 ${preview.taskCount} · 分类 ${preview.categoryCount} · 事件 ${preview.eventCount} · 冲突 ${preview.conflicts.length}</p>` : ''}
      ${state.kind === 'preview' ? `<fieldset class="import-mode"><legend>选择导入方式</legend>
        <label><input type="radio" name="import-mode" value="merge" checked> 合并（冲突保留较新版本）</label>
        <label><input type="radio" name="import-mode" value="replace"> 覆盖（先建立本机恢复点）</label>
      </fieldset>
      <button type="button" id="confirm-import" ${state.canConfirm ? '' : 'disabled'}>确认导入</button>` : ''}
    </div>`;
  }

  function renderDataState(signal) {
    if (signal?.aborted) return;
    const region = root.querySelector('#data-state');
    if (region === null) return;
    region.innerHTML = dataStateMarkup(dataController.state);
    region.querySelector('#confirm-import')?.addEventListener('click', () => {
      const mode = root.querySelector('input[name="import-mode"]:checked')?.value ?? 'merge';
      if (mode === 'replace') {
        const confirmation = root.querySelector('#replace-import-confirm');
        confirmation.showModal();
        confirmation.addEventListener('close', () => {
          if (confirmation.returnValue !== 'confirm') return;
          runViewAction(async () => {
            await dataController.confirm(mode);
            if (dataController.state.kind === 'result') await onDataChanged();
            if (signal?.aborted) return;
            renderDataState(signal);
          }, { signal, onError });
        }, { once: true });
        return;
      }
      runViewAction(async () => {
        await dataController.confirm(mode);
        if (dataController.state.kind === 'result') await onDataChanged();
        if (signal?.aborted) return;
        renderDataState(signal);
      }, { signal, onError });
    });
  }

  async function exportBackup(signal) {
    const backup = await backupService.createBackup();
    const contents = backupService.serializeBackup(backup);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `worktodo-backup-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    if (!signal?.aborted) await render(signal);
  }

  async function exportCsv() {
    const [categories, tags, tasks] = await Promise.all([
      taskService.listCategories(),
      tagService.list(),
      query.all(),
    ]);
    const contents = csvService.createCsv({ tasks, categories, tags });
    const filename = `worktodo-tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    csvService.exportDownload(contents, filename);
  }

  async function render(signal) {
    categories = await taskService.listCategories();
    if (signal?.aborted) return;
    const metadata = await settingsRepository.getMetadata() ?? {};
    if (signal?.aborted) return;
    root.innerHTML = `<section class="view-section" aria-labelledby="data-management-heading">
      <div class="section-heading">
        <div><h2 id="data-management-heading">数据管理</h2><p>扩展卸载会清除本地数据。重要工作请定期导出 JSON 备份。</p></div>
        <span class="data-timestamp">最近导出：${metadata.lastExportedAt ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(metadata.lastExportedAt)) : '尚未导出'}</span>
      </div>
      <div class="data-actions" id="data-management">
        <button type="button" id="export-backup" class="button-primary">导出 JSON 备份</button>
        <button type="button" id="export-csv" class="button-secondary">导出 CSV</button>
        <label class="button-secondary file-picker">选择导入文件<input id="import-file" type="file" accept="application/json,.json"></label>
      </div>
      <div id="data-state"></div>
      <dialog class="modal" id="replace-import-confirm">
        <form method="dialog">
          <h2>覆盖本机数据？</h2>
          <p>覆盖前会建立本机恢复点，但导入完成后当前任务、分类和设置将以备份文件为准。</p>
          <div class="dialog-actions"><button value="cancel">取消</button><button class="button-danger" value="confirm">确认覆盖并导入</button></div>
        </form>
      </dialog>
    </section>
    <section class="view-section" aria-labelledby="category-heading">
      <div class="section-heading">
        <div><h2 id="category-heading">分类</h2><p>删除分类时必须把任务迁移到未分类或其他分类，任务本身不会删除。</p></div>
      </div>
      <form id="create-category" class="category-create">
        <label for="new-category">新分类名称</label>
        <input id="new-category" name="name" maxlength="100" required>
        <button type="submit">创建分类</button>
      </form>
      <p class="form-message" id="category-message" role="alert"></p>
      <div class="category-list">${categoryRows(categories)}</div>
      <dialog class="modal" id="delete-category-dialog">
        <form method="dialog">
          <h2>删除分类</h2>
          <p>该分类下的任务会迁移到：</p>
          <label>迁移目标<select name="destination"></select></label>
          <p class="form-message" data-delete-message></p>
          <div class="dialog-actions"><button value="cancel">取消</button><button class="button-danger" value="confirm">删除并迁移</button></div>
        </form>
      </dialog>
    </section>`;

    renderDataState(signal);
    root.querySelector('#export-backup').addEventListener('click', () => {
      runViewAction(() => exportBackup(signal), { signal, onError });
    });
    root.querySelector('#export-csv').addEventListener('click', () => {
      runViewAction(() => exportCsv(), { signal, onError });
    });
    root.querySelector('#import-file').addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file === undefined) return;
      runViewAction(async () => {
        await dataController.selectFile(file);
        if (signal?.aborted) return;
        renderDataState(signal);
        event.target.value = '';
      }, { signal, onError });
    });
    root.querySelector('#create-category').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = event.currentTarget.elements.namedItem('name');
      runViewAction(async () => {
        try {
          await taskService.createCategory(input.value);
          await onDataChanged();
          if (!signal?.aborted) await render(signal);
        } catch (error) {
          if (signal?.aborted) return;
          root.querySelector('#category-message').textContent = error.message;
          input.focus();
        }
      }, { signal, onError });
    });

    const deleteDialog = root.querySelector('#delete-category-dialog');
    deleteDialog.addEventListener('close', () => {
      if (deleteDialog.returnValue !== 'confirm') return;
      const categoryId = deleteDialog.dataset.categoryId;
      runViewAction(async () => {
        try {
          const destination = deleteDialog.querySelector('select').value || null;
          await taskService.deleteCategory(categoryId, destination);
          await onDataChanged();
          if (!signal?.aborted) await render(signal);
        } catch (error) {
          if (signal?.aborted) return;
          deleteDialog.querySelector('[data-delete-message]').textContent = error.message;
          requestAnimationFrame(() => deleteDialog.showModal());
        }
      }, { signal, onError });
    });

    root.querySelector('.category-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-category-action]');
      if (button === null) return;
      const row = button.closest('[data-category-id]');
      const categoryId = row.dataset.categoryId;
      if (button.dataset.categoryAction === 'rename') {
        runViewAction(async () => {
          try {
            await taskService.renameCategory(categoryId, row.querySelector('input').value);
            await onDataChanged();
            if (!signal?.aborted) await render(signal);
          } catch (error) {
            if (signal?.aborted) return;
            root.querySelector('#category-message').textContent = error.message;
            row.querySelector('input').focus();
          }
        }, { signal, onError });
        return;
      }
      deleteDialog.dataset.categoryId = categoryId;
      deleteDialog.querySelector('select').innerHTML = categoryOptions(categories, categoryId);
      deleteDialog.querySelector('[data-delete-message]').textContent = '';
      deleteDialog.showModal();
    });
  }

  return { render };
}
