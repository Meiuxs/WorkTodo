import {
  createRecurringTemplate,
  createOccurrenceKey,
  nextOccurrenceDate,
} from '../domain/recurring-template.js';
import { createTask } from '../domain/task.js';
import { createTaskEvent } from '../domain/task-event.js';

export class RecurringService {
  #taskService;
  #taskRepository;
  #templateRepository;
  #subtaskService;
  #now;
  #generateId;

  constructor({
    taskService,
    taskRepository,
    templateRepository,
    subtaskService = null,
    now = () => new Date().toISOString(),
    generateId,
  }) {
    this.#taskService = taskService;
    this.#taskRepository = taskRepository;
    this.#templateRepository = templateRepository;
    this.#subtaskService = subtaskService;
    this.#now = now;
    this.#generateId = generateId;
  }

  async createTemplate(input) {
    const now = this.#now();
    const template = createRecurringTemplate(input, now, this.#generateId());
    const task = createTask({
      ...input,
      seriesId: template.id,
      occurrenceKey: createOccurrenceKey(template.id, input.scheduledDate),
    }, now, this.#generateId());
    const event = createTaskEvent({
      id: this.#generateId(),
      taskId: task.id,
      type: 'CREATE',
      occurredAt: now,
      detail: { recurringTemplateId: template.id },
    });
    return this.#templateRepository.createWithTask(template, task, event);
  }

  async listTemplates() {
    return this.#templateRepository.list();
  }

  async getTemplate(id) {
    return this.#templateRepository.get(id);
  }

  async generateNext(templateId, currentDate, { returnMeta = false } = {}) {
    const template = await this.#templateRepository.get(templateId);
    if (template === undefined || !template.active) return returnMeta ? { task: null, created: false } : null;
    const nextDate = nextOccurrenceDate(template, currentDate);
    const occurrenceKey = createOccurrenceKey(template.id, nextDate);
    const existing = await this.#taskRepository.findByOccurrenceKey(occurrenceKey);
    if (existing !== undefined) return returnMeta ? { task: existing, created: false } : existing;

    const now = this.#now();
    const nextTask = createTask({
      title: template.title,
      description: template.description,
      priority: template.priority,
      categoryId: template.categoryId,
      tagIds: template.tagIds,
      startTime: template.startTime,
      dueTime: template.dueTime,
      scheduledDate: nextDate,
      seriesId: template.id,
      occurrenceKey,
    }, now, this.#generateId());
    const event = createTaskEvent({
      id: this.#generateId(),
      taskId: nextTask.id,
      type: 'CREATE',
      occurredAt: now,
      detail: { recurringTemplateId: template.id, previousOccurrence: currentDate },
    });
    const result = await this.#taskRepository.createIfOccurrenceAbsent(nextTask, event);
    return returnMeta ? { task: result.task, created: result.created === true } : result.task;
  }

  async #completeTask(taskId, revision, options) {
    return this.#subtaskService === null
      ? this.#taskService.complete(taskId, revision)
      : this.#subtaskService.completeParent(taskId, revision, options);
  }

  async complete(taskId, revision, options = {}) {
    const current = await this.#taskService.getTask(taskId);
    const result = await this.#completeTask(taskId, revision, options);
    let next;
    try {
      next = current.seriesId === null
        ? { task: null, created: false }
        : await this.generateNext(current.seriesId, current.scheduledDate, { returnMeta: true });
    } catch (error) {
      // 下一实例写入失败时撤回本次完成，避免重复任务已经完成但用户看不到后续实例。
      try { await this.#taskService.restore(result.task.id, result.task.revision); } catch { /* best effort rollback */ }
      for (const child of [...(result.completedChildren ?? [])].reverse()) {
        try { await this.#taskService.restore(child.id, child.revision); } catch { /* best effort rollback */ }
      }
      throw error;
    }
    return { ...result, nextTask: next.task, nextTaskCreated: next.created };
  }
}
