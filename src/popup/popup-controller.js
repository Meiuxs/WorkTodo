import { isOverdueTask } from '../domain/dates.js';

const OVERDUE_LIMIT = 3;
const TODAY_LIMIT = 3;

export class PopupController {
  #taskService;
  #subtaskService;
  #queryService;
  #statisticsService;
  #today;
  #sendMessage;

  constructor({ taskService, subtaskService = null, queryService, statisticsService, today, sendMessage }) {
    this.#taskService = taskService;
    this.#subtaskService = subtaskService;
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
    // 逾期与今日分离配额：否则 3 个逾期会把今日名额挤空，
    // 今日列表变成没有说明的空白。两个节各自最多取 3 条。
    const overdueTasks = tasks.filter((task) => isOverdueTask(task, date));
    const todayTasks = tasks.filter((task) => !overdueTasks.includes(task));
    return {
      date,
      summary,
      overdueCount: overdueTasks.length,
      overdueTasks: overdueTasks.slice(0, OVERDUE_LIMIT),
      focusTasks: todayTasks.slice(0, TODAY_LIMIT),
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

  /* Popup 里的“轻推进”：不弹确认，但级联语义与工作台完全一致 —
     完成带子任务的父任务时连带完成活动子任务，子任务不得变成孤儿待办。
     撤销同样覆盖父与子；complete 不经过 RecurringService，与工作台普通完成同一底层方法。 */
  async completeTask(id, revision) {
    const complete = this.#subtaskService === null
      ? () => this.#taskService.complete(id, revision)
      : () => this.#subtaskService.completeParent(id, revision, { force: true });
    const { task, completedChildren = [] } = await complete();
    await this.#sendMessage({ type: 'TASK_CHANGED', taskId: id });
    for (const child of completedChildren) {
      await this.#sendMessage({ type: 'TASK_CHANGED', taskId: child.id });
    }
    return { task, completedChildren };
  }

  async restoreTask(id, revision) {
    const { task } = await this.#taskService.restore(id, revision);
    await this.#sendMessage({ type: 'TASK_CHANGED', taskId: id });
    return task;
  }

  /* 撤销完成时逐个恢复被级联完成的子任务，并广播它们的变更。 */
  async restoreTasks(items) {
    for (const item of items) {
      await this.restoreTask(item.id, item.revision);
    }
  }
}
