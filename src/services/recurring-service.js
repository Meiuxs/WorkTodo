import { createRecurringTemplate, createOccurrenceKey } from '../domain/recurring-template.js';
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
}
