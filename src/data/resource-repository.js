import { ConflictError } from './task-repository.js';
import { ValidationError } from '../domain/errors.js';
import { validateResource } from '../domain/resource.js';
import { openWorkTodoDatabase } from './database.js';

function clone(value) {
  return structuredClone(value);
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已中止'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
  });
}

function prepare(resource) {
  const copy = clone(resource);
  validateResource(copy);
  return copy;
}

function metadata(resource) {
  const copy = clone(resource);
  copy.blob = null;
  copy.copyIncluded = resource.storageMode === 'copy' ? false : null;
  return copy;
}

export class ResourceRepository {
  #database;

  constructor(database = null) {
    this.#database = database ?? openWorkTodoDatabase();
  }

  async #getDatabase() {
    return this.#database;
  }

  async create(resource) {
    const resourceToSave = prepare(resource);
    const database = await this.#getDatabase();
    const transaction = database.transaction(['resources', 'resourceBlobs'], 'readwrite');
    transaction.objectStore('resources').add(metadata(resourceToSave));
    if (resourceToSave.blob instanceof Blob) transaction.objectStore('resourceBlobs').put({ id: resourceToSave.id, blob: resourceToSave.blob });
    await transactionResult(transaction);
    return clone(resourceToSave);
  }

  async get(id, { includeBlob = false } = {}) {
    const database = await this.#getDatabase();
    const transaction = database.transaction(includeBlob ? ['resources', 'resourceBlobs'] : 'resources', 'readonly');
    const resource = await requestResult(transaction.objectStore('resources').get(id));
    const blobRecord = includeBlob && resource !== undefined
      ? await requestResult(transaction.objectStore('resourceBlobs').get(id))
      : undefined;
    await transactionResult(transaction);
    if (resource === undefined) return undefined;
    return clone(blobRecord?.blob === undefined ? resource : { ...resource, blob: blobRecord.blob });
  }

  async update(resource, expectedRevision = resource.revision - 1) {
    const resourceToSave = prepare(resource);
    const database = await this.#getDatabase();
    const transaction = database.transaction(['resources', 'resourceBlobs'], 'readwrite');
    const store = transaction.objectStore('resources');
    const current = await requestResult(store.get(resourceToSave.id));
    if (current === undefined) {
      transaction.abort();
      try { await transactionResult(transaction); } catch { /* expected abort */ }
      throw new ValidationError(`资料 ${resourceToSave.id} 不存在`);
    }
    if (current.revision !== expectedRevision) {
      transaction.abort();
      try { await transactionResult(transaction); } catch { /* expected abort */ }
      throw new ConflictError(resourceToSave.id);
    }
    store.put(metadata(resourceToSave));
    const blobs = transaction.objectStore('resourceBlobs');
    if (resourceToSave.blob instanceof Blob) blobs.put({ id: resourceToSave.id, blob: resourceToSave.blob });
    else blobs.delete(resourceToSave.id);
    await transactionResult(transaction);
    return clone(resourceToSave);
  }

  async list({ type = null, text = null, unattachedOnly = false } = {}) {
    const database = await this.#getDatabase();
    const transaction = database.transaction(['resources', 'taskResources'], 'readonly');
    const resources = await requestResult(transaction.objectStore('resources').getAll());
    const relations = await requestResult(transaction.objectStore('taskResources').getAll());
    await transactionResult(transaction);
    const attached = new Set(relations.map((relation) => relation.resourceId));
    const normalizedText = typeof text === 'string' ? text.trim().toLocaleLowerCase() : '';
    return resources
      .filter((resource) => type === null || resource.type === type)
      .filter((resource) => !unattachedOnly || !attached.has(resource.id))
      .filter((resource) => {
        if (normalizedText.length === 0) return true;
        return [resource.title, resource.note, resource.url, resource.fileName, resource.content]
          .filter(Boolean)
          .some((value) => value.toLocaleLowerCase().includes(normalizedText));
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(clone);
  }

  async attachTask(taskId, resourceId) {
    if (typeof taskId !== 'string' || taskId.length === 0) throw new ValidationError('taskId 不能为空');
    const database = await this.#getDatabase();
    const transaction = database.transaction(['resources', 'taskResources', 'resourceBlobs'], 'readwrite');
    const resource = await requestResult(transaction.objectStore('resources').get(resourceId));
    if (resource === undefined) {
      transaction.abort();
      try { await transactionResult(transaction); } catch { /* expected abort */ }
      throw new ValidationError(`资料 ${resourceId} 不存在`);
    }
    const links = transaction.objectStore('taskResources');
    const existing = await requestResult(links.get([taskId, resourceId]));
    if (existing === undefined) {
      const taskLinks = await requestResult(links.index('taskId').getAll(taskId));
      links.put({ taskId, resourceId, position: taskLinks.length, createdAt: new Date().toISOString() });
    }
    await transactionResult(transaction);
  }

  async detachTask(taskId, resourceId) {
    const database = await this.#getDatabase();
    const transaction = database.transaction('taskResources', 'readwrite');
    transaction.objectStore('taskResources').delete([taskId, resourceId]);
    await transactionResult(transaction);
  }

  async listForTask(taskId) {
    const database = await this.#getDatabase();
    const transaction = database.transaction(['resources', 'taskResources'], 'readonly');
    const links = await requestResult(transaction.objectStore('taskResources').index('taskId').getAll(taskId));
    const resourcesStore = transaction.objectStore('resources');
    const resources = await Promise.all(links
      .sort((left, right) => left.position - right.position)
      .map((link) => requestResult(resourcesStore.get(link.resourceId))));
    await transactionResult(transaction);
    return resources.filter(Boolean).map(clone);
  }

  async listTaskIds(resourceId) {
    const database = await this.#getDatabase();
    const transaction = database.transaction('taskResources', 'readonly');
    const links = await requestResult(transaction.objectStore('taskResources').index('resourceId').getAll(resourceId));
    await transactionResult(transaction);
    return links.sort((left, right) => left.position - right.position).map((link) => link.taskId);
  }

  async delete(id) {
    const database = await this.#getDatabase();
    const transaction = database.transaction(['resources', 'taskResources'], 'readwrite');
    const resources = transaction.objectStore('resources');
    const resource = await requestResult(resources.get(id));
    if (resource === undefined) {
      transaction.abort();
      try { await transactionResult(transaction); } catch { /* expected abort */ }
      throw new ValidationError(`资料 ${id} 不存在`);
    }
    const links = transaction.objectStore('taskResources');
    const relations = await requestResult(links.index('resourceId').getAll(id));
    relations.forEach((relation) => links.delete([relation.taskId, relation.resourceId]));
    resources.delete(id);
    transaction.objectStore('resourceBlobs').delete(id);
    await transactionResult(transaction);
  }

  async exportAll() {
    const database = await this.#getDatabase();
    const transaction = database.transaction(['resources', 'taskResources'], 'readonly');
    const [resources, taskResources] = await Promise.all([
      requestResult(transaction.objectStore('resources').getAll()),
      requestResult(transaction.objectStore('taskResources').getAll()),
    ]);
    await transactionResult(transaction);
    return clone({ resources, taskResources });
  }

  async replaceAll(snapshot) {
    const resources = (snapshot.resources ?? []).map(prepare);
    const taskResources = clone(snapshot.taskResources ?? []);
    const resourceIds = new Set(resources.map((resource) => resource.id));
    const taskResourceKeys = new Set();
    for (const relation of taskResources) {
      if (relation === null || typeof relation !== 'object'
        || typeof relation.taskId !== 'string' || typeof relation.resourceId !== 'string'
        || !resourceIds.has(relation.resourceId)) {
        throw new ValidationError('taskResources 必须引用备份中的资料');
      }
      const key = `${relation.taskId}:${relation.resourceId}`;
      if (taskResourceKeys.has(key)) throw new ValidationError('taskResources 不能重复');
      taskResourceKeys.add(key);
    }
    const database = await this.#getDatabase();
    const transaction = database.transaction(['resources', 'taskResources', 'resourceBlobs'], 'readwrite');
    const resourcesStore = transaction.objectStore('resources');
    const linksStore = transaction.objectStore('taskResources');
    const blobsStore = transaction.objectStore('resourceBlobs');
    resourcesStore.clear();
    linksStore.clear();
    blobsStore.clear();
    resources.forEach((resource) => {
      resourcesStore.put(metadata(resource));
      if (resource.blob instanceof Blob) blobsStore.put({ id: resource.id, blob: resource.blob });
    });
    taskResources.forEach((relation) => linksStore.put(relation));
    await transactionResult(transaction);
  }
}
