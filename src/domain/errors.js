export class DomainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ValidationError extends DomainError {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class TransitionError extends DomainError {
  constructor(message) {
    super(message);
    this.name = 'TransitionError';
  }
}

export class ConflictError extends DomainError {
  constructor(taskId) {
    super(`任务 ${taskId} 已被其他编辑更新`);
    this.name = 'ConflictError';
    this.taskId = taskId;
  }
}
