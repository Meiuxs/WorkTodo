import { createResource, updateResource } from '../domain/resource.js';
import { ValidationError } from '../domain/errors.js';
import { generateId } from '../shared/ids.js';

function now() {
  return new Date().toISOString();
}

export class ResourceService {
  #repository;
  #generateId;
  #now;

  constructor(repository, { generate = generateId, clock = now } = {}) {
    this.#repository = repository;
    this.#generateId = generate;
    this.#now = clock;
  }

  async createUrl(input) {
    const resource = createResource({ ...input, type: 'url' }, { id: this.#generateId(), now: this.#now() });
    return this.#repository.create(resource);
  }

  async createSnippet(input) {
    const resource = createResource({ ...input, type: 'snippet' }, { id: this.#generateId(), now: this.#now() });
    return this.#repository.create(resource);
  }

  async createFile({ file, saveCopy = false, ...input }) {
    if (!(file instanceof Blob)) throw new ValidationError('请选择有效文件');
    const fileName = input.fileName ?? file.name ?? '未命名文件';
    const resource = createResource({
      ...input,
      type: 'file',
      file,
      title: input.title ?? fileName,
      fileName,
      mimeType: input.mimeType ?? file.type,
      size: file.size,
      lastModified: input.lastModified ?? file.lastModified,
      storageMode: saveCopy ? 'copy' : 'reference',
      blob: saveCopy ? file : null,
    }, { id: this.#generateId(), now: this.#now() });
    return this.#repository.create(resource);
  }

  async update(id, changes, expectedRevision) {
    const current = await this.#repository.get(id);
    if (current === undefined) throw new ValidationError(`资料 ${id} 不存在`);
    const updated = updateResource(current, { ...changes, updatedAt: this.#now() });
    return this.#repository.update(updated, expectedRevision ?? current.revision);
  }

  async attach(taskId, resourceId) {
    await this.#repository.attachTask(taskId, resourceId);
    return this.#repository.listForTask(taskId);
  }

  async detach(taskId, resourceId) {
    await this.#repository.detachTask(taskId, resourceId);
    return this.#repository.listForTask(taskId);
  }

  async list(options) {
    return this.#repository.list(options);
  }

  async listForTask(taskId) {
    return this.#repository.listForTask(taskId);
  }

  async listTaskIds(resourceId) {
    return this.#repository.listTaskIds(resourceId);
  }

  async remove(id, { force = false } = {}) {
    const taskIds = await this.#repository.listTaskIds(id);
    if (taskIds.length > 0 && !force) {
      throw new ValidationError('资料仍关联任务，请先解除关联或确认删除');
    }
    await this.#repository.delete(id);
  }
}
