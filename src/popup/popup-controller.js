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

  async undoCreate(task) {
    const result = await this.#taskService.undoCreate(task.id, task.revision);
    await this.#sendMessage({ type: 'TASK_CHANGED', taskId: task.id });
    return result;
  }

  /* Popup 里的“轻推进”：一键完成当前事项，父带子任务也直接完成（与工作台确认路径不同），
     靠 toast 撤销兜底。complete 不经过 RecurringService，与工作台普通完成同一底层方法。 */
  async completeTask(id, revision) {
    const { task } = await this.#taskService.complete(id, revision);
    await this.#sendMessage({ type: 'TASK_CHANGED', taskId: id });
    return task;
  }

  async restoreTask(id, revision) {
    const { task } = await this.#taskService.restore(id, revision);
    await this.#sendMessage({ type: 'TASK_CHANGED', taskId: id });
    return task;
  }
}
