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
