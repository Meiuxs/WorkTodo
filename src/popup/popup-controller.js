import { isOverdueTask } from '../domain/dates.js';

export class PopupController {
  #taskService;
  #queryService;
  #statisticsService;
  #today;
  #sendMessage;

  constructor({ taskService, queryService, statisticsService, today, sendMessage }) {
    this.#taskService = taskService;
    this.#queryService = queryService;
    this.#statisticsService = statisticsService;
    this.#today = today;
    this.#sendMessage = sendMessage;
  }

  async load() {
    const date = this.#today();
    const [tasks, summary] = await Promise.all([
      this.#queryService.today(date),
      this.#statisticsService.daily(date),
    ]);
    return {
      date,
      summary,
      overdueCount: tasks.filter((task) => isOverdueTask(task, date)).length,
      focusTasks: tasks.slice(0, 3),
    };
  }

  async quickCreate(title, scheduledDate = null) {
    const { task } = await this.#taskService.create({ title, scheduledDate });
    await this.#sendMessage({ type: 'TASK_CHANGED', taskId: task.id });
    return task;
  }
}
