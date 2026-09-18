const ROUTES = new Set([
  'today',
  'tomorrow',
  'week',
  'month',
  'inbox',
  'resources',
  'all',
  'completed',
  'trash',
  'history',
  'settings',
]);

export class DashboardController {
  #views;
  #taskService;
  #subtaskService;
  #recurringService;
  #sendMessage;
  #onRendered;
  #route = 'today';
  #renderAbortController = null;

  constructor({
    views,
    taskService = null,
    subtaskService = null,
    recurringService = null,
    sendMessage = async () => {},
    onRendered = null,
  }) {
    this.#views = views;
    this.#taskService = taskService;
    this.#subtaskService = subtaskService;
    this.#recurringService = recurringService;
    this.#sendMessage = sendMessage;
    this.#onRendered = onRendered;
  }

  get route() {
    return this.#route;
  }

  async navigate(route) {
    const nextRoute = ROUTES.has(route) && this.#views[route] !== undefined ? route : 'today';
    this.#route = nextRoute;
    await this.#render(nextRoute);
    return nextRoute;
  }

  async refresh() {
    await this.#render(this.#route);
  }

  #render(route) {
    this.#renderAbortController?.abort();
    const renderAbortController = new AbortController();
    this.#renderAbortController = renderAbortController;
    return this.#renderView(route, renderAbortController);
  }

  async #renderView(route, renderAbortController) {
    const render = Promise.resolve().then(() => (
      this.#views[route].render(renderAbortController.signal)
    ));
    void render.catch(() => {});
    const aborted = new Promise((resolve) => {
      renderAbortController.signal.addEventListener('abort', resolve, { once: true });
    });
    try {
      await Promise.race([render, aborted]);
    } catch (error) {
      if (renderAbortController.signal.aborted || error?.name === 'AbortError') return;
      throw error;
    }
    // 渲染成功后顺带刷新外壳上的附属信息（如侧栏数量角标）。
    // 不 await：附属信息失败或变慢都不应该拖住导航。
    if (this.#onRendered !== null) {
      Promise.resolve().then(() => this.#onRendered()).catch(() => {});
    }
  }

  async onMessage(message) {
    if (message?.type === 'TASK_CHANGED') await this.refresh();
  }

  async createTask(input) {
    const result = await this.#taskService.create(input);
    await this.#sendMessage({ type: 'TASK_CHANGED', taskId: result.task.id });
    await this.refresh();
    return result;
  }

  async editTask(taskId, changes, revision) {
    const result = await this.#taskService.edit(taskId, changes, revision);
    await this.#sendMessage({ type: 'TASK_CHANGED', taskId: result.task.id });
    await this.refresh();
    return result;
  }

  async handleTaskAction(action, taskId, revision, value = undefined) {
    const methods = {
      start: 'start',
      complete: 'complete',
      restore: 'restore',
      cancel: 'cancel',
      trash: 'trash',
      untrash: 'untrash',
      'delete-permanently': 'permanentlyDelete',
      copy: 'copy',
    };
    let result;
    if (action === 'complete' && this.#recurringService !== null) {
      const force = value?.force === true;
      result = await this.#recurringService.complete(taskId, revision, { force });
    } else if (action === 'complete' && this.#subtaskService !== null) {
      const force = value?.force === true;
      result = await this.#subtaskService.completeParent(taskId, revision, { force });
    } else if (action === 'postpone' || action === 'reschedule') {
      result = await this.#taskService[action](taskId, value, revision);
    } else if (methods[action] === 'copy') {
      result = await this.#taskService.copy(taskId);
    } else if (methods[action] !== undefined) {
      result = await this.#taskService[methods[action]](taskId, revision);
    } else {
      throw new Error(`不支持的任务操作: ${action}`);
    }
    await this.#sendMessage({ type: 'TASK_CHANGED', taskId: result.task.id });
    await this.refresh();
    return result;
  }
}
