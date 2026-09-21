import { escapeHtml, runViewAction } from '../../shared/ui.js';
import { applyTheme, THEME_SETTINGS } from '../../shared/theme.js';

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
        message: `可以导入 ${preview.taskCount} 个任务、${preview.categoryCount} 个列表、${preview.eventCount} 条事件和 ${preview.resourceCount} 条资料。`,
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
        message: `导入完成：${preview.taskCount} 个任务、${preview.resourceCount} 条资料，${preview.conflicts.length} 项冲突已按较新版本处理。${preview.omittedFileCopies > 0 ? ` 有 ${preview.omittedFileCopies} 个文件副本未包含，需要重新选择文件。` : ''}`,
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

  /* 清除是不可逆动作，结果复用同一套 state，由 #data-state 统一播报。
     kind 用 clearing 而不是 importing：清除不是导入，语义不同就不该互相借用。 */
  async clearAll() {
    this.#state = {
      kind: 'clearing',
      canConfirm: false,
      message: '正在清除本地数据…',
      preview: null,
      text: null,
    };
    try {
      await this.#backupService.clearAllData();
      this.#state = {
        kind: 'result',
        canConfirm: false,
        message: '已清除全部本地数据；主题等偏好设置已保留。',
        preview: null,
        text: null,
      };
    } catch (error) {
      this.#state = {
        kind: 'error',
        canConfirm: false,
        message: '清除没有完成，本机原有数据保持不变。',
        preview: null,
        text: null,
      };
    }
    return this.#state;
  }

  reset() {
    this.#state = clone(INITIAL_STATE);
  }
}

function categoryOptions(categories, selectedId = '') {
  return '<option value="">转为未归入列表</option>' + categories
    .filter((item) => item.id !== selectedId)
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join('');
}

function categoryRows(categories) {
  if (categories.length === 0) {
    return `<div class="empty-state">
      <p class="empty-state__title">还没有列表</p>
      <p class="empty-state__text">创建后可在任务编辑器中分配。</p>
    </div>`;
  }
  return categories.map((item) => `<div class="category-row" data-category-id="${escapeHtml(item.id)}">
    <label class="sr-only" for="category-${escapeHtml(item.id)}">列表名称</label>
    <input id="category-${escapeHtml(item.id)}" value="${escapeHtml(item.name)}" maxlength="100">
    <button type="button" data-category-action="rename">保存名称</button>
    <button type="button" data-category-action="delete">删除列表</button>
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
    if (state.kind === 'idle') return '';
    const preview = state.preview;
    return `<div class="data-state data-state--${state.kind}" role="status">
      <p>${escapeHtml(state.message)}</p>
      ${state.kind === 'preview' ? `<p class="data-preview">任务 ${preview.taskCount} · 列表 ${preview.categoryCount} · 事件 ${preview.eventCount} · 资料 ${preview.resourceCount} · 冲突 ${preview.conflicts.length}</p>${preview.omittedFileCopies > 0 ? `<p class="data-warning">有 ${preview.omittedFileCopies} 个文件副本不会包含在 JSON 备份中，导入后需要重新选择文件。</p>` : ''}` : ''}
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
      const confirmation = root.querySelector('#import-confirm');
      const trigger = root.querySelector('#confirm-import');
      const preview = dataController.state.preview;
      const title = confirmation.querySelector('[data-import-confirm-title]');
      const message = confirmation.querySelector('[data-import-confirm-message]');
      const submit = confirmation.querySelector('[data-import-confirm-submit]');
      if (mode === 'replace') {
        title.textContent = '覆盖本机数据？';
        message.textContent = `覆盖前会建立本机恢复点；导入 ${preview.taskCount} 个任务、${preview.categoryCount} 个列表和 ${preview.resourceCount} 条资料后，当前数据将以备份文件为准。${preview.omittedFileCopies > 0 ? ` ${preview.omittedFileCopies} 个文件副本不会导入，之后需要重新选择文件。` : ''}`;
        submit.textContent = '确认覆盖并导入';
      } else {
        title.textContent = '合并到本机数据？';
        message.textContent = `将合并 ${preview.taskCount} 个任务、${preview.categoryCount} 个列表和 ${preview.resourceCount} 条资料；发现 ${preview.conflicts.length} 个冲突时保留较新版本。${preview.omittedFileCopies > 0 ? ` ${preview.omittedFileCopies} 个文件副本不会导入。` : ''}`;
        submit.textContent = '确认导入';
      }
      confirmation.showModal();
      confirmation.querySelector('[value="cancel"]')?.focus();
      confirmation.addEventListener('close', () => {
        trigger?.focus();
        if (confirmation.returnValue !== 'confirm') return;
        runViewAction(async () => {
          await dataController.confirm(mode);
          if (dataController.state.kind === 'result') await onDataChanged();
          if (signal?.aborted) return;
          renderDataState(signal);
        }, { signal, onError });
      }, { once: true });
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

  /* 列表的增删改只影响 .category-list 区域：重取数据后只重建这一块，
     不碰整个设置视图——否则主题选择、导入预览状态会被连带重置。 */
  async function renderCategoryList(signal) {
    categories = await taskService.listCategories();
    if (signal?.aborted) return;
    const list = root.querySelector('.category-list');
    if (list !== null) list.innerHTML = categoryRows(categories);
  }

  async function render(signal) {
    categories = await taskService.listCategories();
    if (signal?.aborted) return;
    const [metadataValue, settings] = await Promise.all([
      settingsRepository.getMetadata(),
      settingsRepository.getSettings(),
    ]);
    if (signal?.aborted) return;
    const metadata = metadataValue ?? {};
    const selectedTheme = THEME_SETTINGS.includes(settings?.theme) ? settings.theme : 'system';
    root.innerHTML = `<section class="view-section view-section--panel" aria-labelledby="appearance-heading">
      <div class="section-heading">
        <div><h2 id="appearance-heading">外观</h2></div>
      </div>
      <label class="field theme-setting">主题
        <select data-theme-setting>
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
    </section>
    <section class="view-section view-section--panel" aria-labelledby="data-management-heading">
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
      <dialog class="modal" id="import-confirm">
        <form method="dialog">
          <h2 data-import-confirm-title>确认导入？</h2>
          <p data-import-confirm-message></p>
          <div class="dialog-actions"><button value="cancel">取消</button><button class="button-danger" value="confirm" data-import-confirm-submit>确认导入</button></div>
        </form>
      </dialog>
    </section>
    <section class="view-section view-section--panel" aria-labelledby="category-heading">
      <div class="section-heading">
        <div><h2 id="category-heading">列表</h2><p>删除列表时必须把任务迁移到未归入列表或其他列表，任务本身不会删除。</p></div>
      </div>
      <form id="create-category" class="category-create">
        <label for="new-category">新列表名称</label>
        <input id="new-category" name="name" maxlength="100" required>
        <button type="submit">创建列表</button>
      </form>
      <p class="form-message" id="category-message" role="alert"></p>
      <div class="category-list">${categoryRows(categories)}</div>
      <dialog class="modal" id="delete-category-dialog">
        <form method="dialog">
          <h2>删除列表</h2>
          <p>该列表下的任务会迁移到：</p>
          <label>迁移目标<select name="destination"></select></label>
          <p class="form-message" data-delete-message></p>
          <div class="dialog-actions"><button value="cancel">取消</button><button class="button-danger" value="confirm">删除并迁移</button></div>
        </form>
      </dialog>
    </section>
    <section class="view-section view-section--panel" aria-labelledby="shortcuts-heading">
      <div class="section-heading">
        <div><h2 id="shortcuts-heading">键盘快捷键</h2><p>焦点在输入框里时页面快捷键不生效；弹窗打开期间全局快捷键暂停。</p></div>
      </div>
      <table class="shortcuts-table" role="table">
        <caption class="sr-only">工作台键盘快捷键清单</caption>
        <tbody role="rowgroup">
          <tr role="row"><th scope="row" role="rowheader"><kbd class="kbd">T</kbd></th><td role="cell">回到今天</td></tr>
          <tr role="row"><th scope="row" role="rowheader"><kbd class="kbd">W</kbd></th><td role="cell">本周</td></tr>
          <tr role="row"><th scope="row" role="rowheader"><kbd class="kbd">M</kbd></th><td role="cell">月历</td></tr>
          <tr role="row"><th scope="row" role="rowheader"><kbd class="kbd">N</kbd></th><td role="cell">聚焦快速记录输入框</td></tr>
          <tr role="row"><th scope="row" role="rowheader"><kbd class="kbd">F</kbd></th><td role="cell">聚焦全部任务的搜索框</td></tr>
          <tr role="row"><th scope="row" role="rowheader"><kbd class="kbd">D</kbd></th><td role="cell">在任务行上：展开菜单并选中改期首项</td></tr>
          <tr role="row"><th scope="row" role="rowheader"><kbd class="kbd">P</kbd></th><td role="cell">在任务行上：循环优先级（无→低→中→高）</td></tr>
        </tbody>
      </table>
    </section>
    <section class="view-section view-section--danger" aria-labelledby="danger-zone-heading">
      <div class="danger-zone">
        <div class="danger-zone__body">
          <h2 id="danger-zone-heading">危险区域</h2>
          <p>清除本机的全部任务、列表、标签、资料和工作记录，并清空回收站；主题等偏好设置会保留。清除后无法恢复，建议先导出 JSON 备份。</p>
        </div>
        <button type="button" id="clear-all-data" class="button-danger">清除所有数据</button>
      </div>
      <dialog class="modal" id="clear-all-dialog">
        <form method="dialog">
          <h2>清除所有数据？</h2>
          <p>会删除全部任务、列表、标签、资料、重复规则和工作记录，并清空回收站。主题等偏好设置会保留。</p>
          <p>清除后无法恢复，也不能撤销。建议先导出 JSON 备份。</p>
          <div class="dialog-actions"><button value="cancel">取消</button><button class="button-danger" value="confirm">清除所有数据</button></div>
        </form>
      </dialog>
    </section>`;

    const themeSelect = root.querySelector('[data-theme-setting]');
    themeSelect.value = selectedTheme;
    themeSelect.addEventListener('change', () => {
      runViewAction(async () => {
        const current = await settingsRepository.getSettings() ?? {};
        const next = { ...current, theme: themeSelect.value };
        try {
          await settingsRepository.saveSettings(next);
        } catch (error) {
          themeSelect.value = THEME_SETTINGS.includes(current.theme) ? current.theme : 'system';
          throw error;
        }
        applyTheme(next.theme);
      }, { signal, onError });
    });
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
    const clearDialog = root.querySelector('#clear-all-dialog');
    const clearTrigger = root.querySelector('#clear-all-data');
    clearTrigger.addEventListener('click', () => {
      clearDialog.showModal();
      // 规范 §4.5：默认焦点落在安全动作上。
      clearDialog.querySelector('[value="cancel"]')?.focus();
    });
    clearDialog.addEventListener('close', () => {
      // 规范 §4.5：关框后焦点回到触发它的控件。
      clearTrigger.focus();
      if (clearDialog.returnValue !== 'confirm') return;
      runViewAction(async () => {
        await dataController.clearAll();
        if (dataController.state.kind === 'result') {
          // 成功会整页重渲染，新的 #data-state 会读到 result 状态；
          // 但它也换掉了设置页 DOM，焦点会落回 body，所以要把焦点还给清空后的同名按钮。
          // 注意这里刻意不复用 signal——重渲染已经把它中止了。
          await onDataChanged();
          root.querySelector('#clear-all-data')?.focus();
          return;
        }
        // 失败不触发重渲染，必须在这里就地播报 error。
        if (signal?.aborted) return;
        renderDataState(signal);
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
          await renderCategoryList(signal);
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
            await renderCategoryList(signal);
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
