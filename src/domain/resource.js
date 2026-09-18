import { ValidationError } from './errors.js';

export const RESOURCE_TYPES = Object.freeze(['url', 'file', 'snippet']);
export const MAX_RESOURCE_NOTE_LENGTH = 2_000;
export const MAX_RESOURCE_CONTENT_LENGTH = 20_000;
export const MAX_RESOURCE_COPY_BYTES = 20 * 1024 * 1024;

function clone(value) {
  return structuredClone(value);
}

function text(value, field, { required = false, max = Infinity } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`${field} 不能为空`);
    return '';
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} 必须是字符串`);
  const normalized = value.trim();
  if (required && normalized.length === 0) throw new ValidationError(`${field} 不能为空`);
  if (normalized.length > max) throw new ValidationError(`${field} 不能超过 ${max} 个字符`);
  return normalized;
}

function assertType(type) {
  if (!RESOURCE_TYPES.includes(type)) throw new ValidationError(`不支持的资料类型: ${type}`);
}

function normalizeUrl(value) {
  const url = text(value, 'url', { required: true, max: 2000 });
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('url 必须是有效的网页地址');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ValidationError('url 只支持 http 或 https');
  }
  return url;
}

function normalizeFile(input) {
  const fileName = text(input.fileName, 'fileName', { required: true, max: 500 });
  const size = input.size ?? input.file?.size ?? 0;
  if (!Number.isInteger(size) || size < 0) throw new ValidationError('file size 必须是非负整数');
  const storageMode = input.storageMode ?? 'reference';
  if (!['reference', 'copy'].includes(storageMode)) throw new ValidationError('storageMode 无效');
  const blob = input.blob ?? (storageMode === 'copy' ? input.file : null);
  if (storageMode === 'copy') {
    if (!(blob instanceof Blob) && input.copyIncluded !== false) throw new ValidationError('保存文件副本需要有效文件');
    if (size > MAX_RESOURCE_COPY_BYTES) throw new ValidationError('文件副本不能超过 20 MB');
  }
  return {
    fileName,
    mimeType: text(input.mimeType ?? input.file?.type, 'mimeType', { max: 200 }) || null,
    size,
    lastModified: input.lastModified ?? input.file?.lastModified ?? null,
    storageMode,
    blob: storageMode === 'copy' && blob instanceof Blob ? blob : null,
  };
}

export function validateResource(resource) {
  if (resource === null || typeof resource !== 'object' || Array.isArray(resource)) {
    throw new ValidationError('resource 必须是对象');
  }
  if (typeof resource.id !== 'string' || resource.id.length === 0) throw new ValidationError('resource.id 不能为空');
  assertType(resource.type);
  text(resource.title, 'title', { required: true, max: 200 });
  text(resource.note, 'note', { max: MAX_RESOURCE_NOTE_LENGTH });
  if (resource.type === 'url') normalizeUrl(resource.url);
  if (resource.type === 'snippet') text(resource.content, 'content', { required: true, max: MAX_RESOURCE_CONTENT_LENGTH });
  if (resource.type === 'file') normalizeFile(resource);
  if (typeof resource.createdAt !== 'string' || typeof resource.updatedAt !== 'string') {
    throw new ValidationError('资料时间字段无效');
  }
  if (!Number.isInteger(resource.revision) || resource.revision < 0) throw new ValidationError('资料 revision 无效');
  return true;
}

export function createResource(input, { id, now }) {
  if (typeof id !== 'string' || id.length === 0) throw new ValidationError('resource.id 不能为空');
  if (typeof now !== 'string' || now.length === 0) throw new ValidationError('resource 时间不能为空');
  assertType(input?.type);
  const title = text(input.title, 'title', { required: true, max: 200 });
  const note = text(input.note, 'note', { max: MAX_RESOURCE_NOTE_LENGTH });
  const resource = {
    id,
    type: input.type,
    title,
    note,
    url: input.type === 'url' ? normalizeUrl(input.url) : null,
    fileName: null,
    mimeType: null,
    size: null,
    lastModified: null,
    storageMode: null,
    blob: null,
    content: input.type === 'snippet' ? text(input.content, 'content', { required: true, max: MAX_RESOURCE_CONTENT_LENGTH }) : null,
    createdAt: now,
    updatedAt: now,
    revision: 0,
  };
  if (input.type === 'file') Object.assign(resource, normalizeFile(input));
  validateResource(resource);
  return clone(resource);
}

export function updateResource(current, changes) {
  validateResource(current);
  const next = {
    ...clone(current),
    ...clone(changes),
    id: current.id,
    type: current.type,
    createdAt: current.createdAt,
    revision: current.revision + 1,
  };
  if (typeof changes.updatedAt !== 'string' || changes.updatedAt.length === 0) {
    throw new ValidationError('updatedAt 不能为空');
  }
  if (next.type === 'url') next.url = normalizeUrl(next.url);
  if (next.type === 'snippet') next.content = text(next.content, 'content', { required: true, max: MAX_RESOURCE_CONTENT_LENGTH });
  if (next.type === 'file') Object.assign(next, normalizeFile(next));
  next.title = text(next.title, 'title', { required: true, max: 200 });
  next.note = text(next.note, 'note', { max: MAX_RESOURCE_NOTE_LENGTH });
  validateResource(next);
  return clone(next);
}
