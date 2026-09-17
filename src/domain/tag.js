import { ValidationError } from './errors.js';

export function createTag({ name }, now, id) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('标签名称不能为空');
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new ValidationError('标签 ID 不能为空');
  }
  return { id, name: name.trim(), createdAt: now, updatedAt: now };
}
