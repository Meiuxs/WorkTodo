import { ConflictError, ValidationError } from '../domain/errors.js';

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
    const parent = await this.#taskService.getTask(parentId);
    if (parent.revision !== revision) throw new ConflictError(parentId);
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

  /* 恢复父任务与级联完成的镜像：确认后把已完成的子任务一并恢复为待办。
     子任务自身或没有已完成子任务时等价于普通恢复；restoredChildren 供反馈文案说明范围。 */
  async restoreParent(parentId, revision, { force = false } = {}) {
    const parent = await this.#taskService.getTask(parentId);
    if (parent.revision !== revision) throw new ConflictError(parentId);
    if (parent.parentId !== null && parent.parentId !== undefined) {
      const result = await this.#taskService.restore(parentId, revision);
      return { ...result, restoredChildren: [] };
    }
    const children = await this.#repository.list({ parentId });
    const completed = children.filter((task) =>
      task.trashedAt === null && task.lifecycle === 'completed');
    if (completed.length > 0 && !force) {
      throw new ValidationError('父任务有已完成子任务');
    }
    const restoredChildren = [];
    try {
      for (const child of completed) {
        const result = await this.#taskService.restore(child.id, child.revision);
        restoredChildren.push(result.task);
      }
      const result = await this.#taskService.restore(parentId, revision);
      return { ...result, restoredChildren };
    } catch (error) {
      for (const child of restoredChildren.reverse()) {
        try { await this.#taskService.complete(child.id, child.revision); } catch { /* best effort rollback */ }
      }
      throw error;
    }
  }
}
