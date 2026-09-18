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

  async generateNext(templateId, currentDate) {
    const template = await this.#templateRepository.get(templateId);
    if (template === undefined || !template.active) return null;
    const nextDate = nextOccurrenceDate(template, currentDate);
    const occurrenceKey = createOccurrenceKey(template.id, nextDate);
    const existing = await this.#taskRepository.findByOccurrenceKey(occurrenceKey);
    if (existing !== undefined) return existing;

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
    return result.task;
  }

  async #completeTask(taskId, revision, options) {
    return this.#subtaskService === null
      ? this.#taskService.complete(taskId, revision)
      : this.#subtaskService.completeParent(taskId, revision, options);
  }

  async complete(taskId, revision, options = {}) {
    const current = await this.#taskService.getTask(taskId);
    const result = await this.#completeTask(taskId, revision, options);
    const nextTask = current.seriesId === null
      ? null
      : await this.generateNext(current.seriesId, current.scheduledDate);
    return { ...result, nextTask };
  }
}
