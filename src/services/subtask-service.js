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
    if (parent.parentId !== null && parent.parentId !== undefined) {
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

  #activeChildren(children) {
    return children.filter((task) => (
      task.trashedAt === null && !['completed', 'cancelled'].includes(task.lifecycle)
    ));
  }

  /* 完成父任务时默认连带完成其未完成的子任务：
     - 无未完成子任务：直接完成父任务；
     - 有未完成子任务且未确认（force=false）：抛错，由界面先弹确认；
     - 确认后（force=true）：先级联完成子任务，再完成父任务，返回被自动完成的子任务供撤销时逐个恢复。 */
  async completeParent(parentId, revision, { force = false } = {}) {
    const children = await this.#repository.list({ parentId });
    const active = this.#activeChildren(children);
    if (active.length > 0 && !force) {
      throw new ValidationError('父任务仍有未完成子任务');
    }
    const completedChildren = [];
    try {
      for (const child of active) {
        const result = await this.#taskService.complete(child.id, child.revision);
        completedChildren.push(result.task);
      }
      const result = await this.#taskService.complete(parentId, revision);
      return { ...result, completedChildren };
    } catch (error) {
      for (const child of completedChildren.reverse()) {
        try { await this.#taskService.restore(child.id, child.revision); } catch { /* best effort rollback */ }
      }
      throw error;
    }
  }
}
