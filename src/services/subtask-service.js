import { ValidationError } from '../domain/errors.js';

export class SubtaskService {
  #taskService;
  #repository;

  constructor(taskService, repository) {
    this.#taskService = taskService;
    this.#repository = repository;
  }

  async createSubtask(parentId, input) {
    const parent = await this.#taskService.getTask(parentId);
    if (parent.parentId !== null) {
      throw new ValidationError('子任务不能再创建子任务');
    }
    return this.#taskService.create({ ...input, parentId });
  }

  list(parentId) {
    return this.#repository.list({ parentId });
  }

  async activeCount(parentId) {
    const children = await this.#repository.list({ parentId });
    return children.filter((task) => (
      task.trashedAt === null && !['completed', 'cancelled'].includes(task.lifecycle)
    )).length;
  }

  async completeParent(parentId, revision, { force = false } = {}) {
    if (!force && (await this.activeCount(parentId)) > 0) {
      throw new ValidationError('父任务仍有未完成子任务');
    }
    return this.#taskService.complete(parentId, revision);
  }
}
