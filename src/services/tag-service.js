import { ValidationError } from '../domain/errors.js';
import { createTag } from '../domain/tag.js';
import { createTaskEvent } from '../domain/task-event.js';
import { generateId as defaultGenerateId } from '../shared/ids.js';

function defaultNow() {
  return new Date().toISOString();
}

export class TagService {
  #repository;
  #now;
  #generateId;

  constructor(repository, { now = defaultNow, generateId = defaultGenerateId } = {}) {
    this.#repository = repository;
    this.#now = now;
    this.#generateId = generateId;
  }

  create(name) {
    return this.#repository.create(createTag({ name }, this.#now(), this.#generateId()));
  }

  list() {
    return this.#repository.list();
  }

  async rename(id, name) {
    const current = await this.#repository.get(id);
    if (current === undefined) throw new ValidationError(`标签 ${id} 不存在`);
    const tag = createTag({ name }, this.#now(), id);
    return this.#repository.update({ ...tag, createdAt: current.createdAt });
  }

  deleteAndDetach(id) {
    const now = this.#now();
    return this.#repository.deleteAndDetach(id, {
      updatedAt: now,
      createEvent: (task) => createTaskEvent({
        id: this.#generateId(),
        taskId: task.id,
        type: 'EDIT',
        occurredAt: now,
        detail: { removedTagId: id },
      }),
    });
  }
}
