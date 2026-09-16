import { ValidationError } from '../domain/errors.js';
import { createTask, transitionTask, validateTask } from '../domain/task.js';
import { createTaskEvent } from '../domain/task-event.js';
import { generateId as defaultGenerateId } from '../shared/ids.js';

function defaultNow() {
  return new Date().toISOString();
}

function categoryName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('分类名称不能为空');
  }
  return name.trim();
}

export class TaskService {
  #repository;
  #now;
  #generateId;

  constructor(repository, { now = defaultNow, generateId = defaultGenerateId } = {}) {
    this.#repository = repository;
    this.#now = now;
    this.#generateId = generateId;
  }

  #event(taskId, type, detail = null) {
    return createTaskEvent({
      id: this.#generateId(),
      taskId,
      type,
      occurredAt: this.#now(),
      detail,
    });
  }

  async #task(id) {
    const task = await this.#repository.get(id);
    if (task === undefined) throw new ValidationError(`任务 ${id} 不存在`);
    return task;
  }

  async #transition(id, expectedRevision, action, type, detail = null, adjust = (task) => task) {
    const current = await this.#task(id);
    const now = this.#now();
    const next = adjust(transitionTask(current, action, now), now);
    validateTask(next);
    const event = createTaskEvent({
      id: this.#generateId(), taskId: id, type, occurredAt: now, detail,
    });
    const task = await this.#repository.update(next, expectedRevision, event);
    return { task, event };
  }

  async create(input) {
    const now = this.#now();
    const task = {
      ...createTask(input, now, this.#generateId()),
      categoryId: input?.categoryId ?? null,
      cancelledAt: null,
    };
    const event = createTaskEvent({
      id: this.#generateId(), taskId: task.id, type: 'CREATE', occurredAt: now, detail: null,
    });
    return { task: await this.#repository.create(task, event), event };
  }

  async edit(id, changes, expectedRevision) {
    const current = await this.#task(id);
    const input = changes ?? {};
    const hasScheduledDate = Object.hasOwn(input, 'scheduledDate');
    const scheduled = hasScheduledDate && input.scheduledDate !== current.scheduledDate
      ? transitionTask(current, { type: 'RESCHEDULE', date: input.scheduledDate }, this.#now())
      : { ...current, updatedAt: this.#now(), revision: current.revision + 1 };
    const next = {
      ...scheduled,
      ...(Object.hasOwn(input, 'title') ? { title: input.title } : {}),
      ...(Object.hasOwn(input, 'priority') ? { priority: input.priority } : {}),
      ...(Object.hasOwn(input, 'categoryId') ? { categoryId: input.categoryId } : {}),
      ...(Object.hasOwn(input, 'startTime') ? { startTime: input.startTime } : {}),
      ...(Object.hasOwn(input, 'dueTime') ? { dueTime: input.dueTime } : {}),
    };
    validateTask(next);
    const event = this.#event(
      id,
      hasScheduledDate && input.scheduledDate !== current.scheduledDate ? 'RESCHEDULE' : 'EDIT',
      hasScheduledDate && input.scheduledDate !== current.scheduledDate
        ? { fromDate: current.scheduledDate, toDate: input.scheduledDate }
        : null,
    );
    const task = await this.#repository.update(next, expectedRevision, event);
    return { task, event };
  }

  start(id, expectedRevision) { return this.#transition(id, expectedRevision, { type: 'START' }, 'START'); }
  complete(id, expectedRevision) { return this.#transition(id, expectedRevision, { type: 'COMPLETE' }, 'COMPLETE'); }
  restore(id, expectedRevision) {
    return this.#transition(id, expectedRevision, { type: 'RESTORE' }, 'RESTORE', null, (task) => ({ ...task, cancelledAt: null }));
  }
  async postpone(id, date, expectedRevision) {
    const current = await this.#task(id);
    const detail = { fromDate: current.scheduledDate, toDate: date };
    return this.#transition(id, expectedRevision, { type: 'POSTPONE', date }, 'POSTPONE', detail);
  }
  reschedule(id, date, expectedRevision) {
    return this.#reschedule(id, date, expectedRevision);
  }

  async #reschedule(id, date, expectedRevision) {
    const current = await this.#task(id);
    const detail = { fromDate: current.scheduledDate, toDate: date };
    return this.#transition(id, expectedRevision, { type: 'RESCHEDULE', date }, 'RESCHEDULE', detail);
  }

  cancel(id, expectedRevision) {
    return this.#transition(id, expectedRevision, { type: 'CANCEL' }, 'CANCEL', null, (task, now) => ({ ...task, cancelledAt: now }));
  }
  trash(id, expectedRevision) { return this.#transition(id, expectedRevision, { type: 'TRASH' }, 'TRASH'); }
  untrash(id, expectedRevision) { return this.#transition(id, expectedRevision, { type: 'UNTRASH' }, 'UNTRASH'); }

  async copy(id) {
    const source = await this.#task(id);
    const now = this.#now();
    const task = {
      ...source,
      id: this.#generateId(),
      lifecycle: 'todo',
      revision: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      cancelledAt: null,
      trashedAt: null,
    };
    validateTask(task);
    const event = createTaskEvent({
      id: this.#generateId(), taskId: task.id, type: 'COPY', occurredAt: now, detail: { sourceTaskId: source.id },
    });
    return { task: await this.#repository.create(task, event), event };
  }

  async createCategory(name) {
    const now = this.#now();
    return this.#repository.createCategory({ id: this.#generateId(), name: categoryName(name), createdAt: now, updatedAt: now });
  }

  async renameCategory(id, name) {
    const current = await this.#repository.getCategory(id);
    if (current === undefined) throw new ValidationError(`分类 ${id} 不存在`);
    return this.#repository.updateCategory({ ...current, name: categoryName(name), updatedAt: this.#now() });
  }

  async deleteCategory(id, destinationCategoryId) {
    if (destinationCategoryId === undefined) throw new ValidationError('删除分类必须明确指定迁移目标');
    if (destinationCategoryId === id) throw new ValidationError('删除分类必须迁移到另一分类或未分类');
    if (destinationCategoryId !== null && (await this.#repository.getCategory(destinationCategoryId)) === undefined) {
      throw new ValidationError(`分类 ${destinationCategoryId} 不存在`);
    }
    const now = this.#now();
    return this.#repository.deleteCategoryAndMoveTasks(id, destinationCategoryId, {
      updatedAt: now,
      createEvent: (task) => createTaskEvent({
        id: this.#generateId(),
        taskId: task.id,
        type: 'EDIT',
        occurredAt: now,
        detail: { fromCategoryId: id, toCategoryId: destinationCategoryId },
      }),
    });
  }
}
