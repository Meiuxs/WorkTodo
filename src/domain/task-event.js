import { ValidationError } from './errors.js';

function assertRequiredString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${fieldName} 不能为空`);
  }
}

export function createTaskEvent({ id, taskId, type, occurredAt, detail = null }) {
  assertRequiredString(id, 'id');
  assertRequiredString(taskId, 'taskId');
  assertRequiredString(type, 'type');
  assertRequiredString(occurredAt, 'occurredAt');
  return {
    id,
    taskId,
    type,
    occurredAt,
    detail: detail === null ? null : structuredClone(detail),
  };
}
