export class UndoController {
  #timer;
  #pending = null;
  #timeout;
  #setTimeout;
  #clearTimeout;

  constructor({
    timeout = 5000,
    setTimeoutFn = globalThis.setTimeout.bind(globalThis),
    clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
  } = {}) {
    this.#timeout = timeout;
    this.#setTimeout = setTimeoutFn;
    this.#clearTimeout = clearTimeoutFn;
  }

  get pending() {
    return this.#pending === null
      ? null
      : { message: this.#pending.message };
  }

  offer(action) {
    this.dismiss();
    this.#pending = action;
    this.#timer = this.#setTimeout(() => this.dismiss(), this.#timeout);
    return this.pending;
  }

  async undo() {
    const action = this.#pending;
    if (action === null) return false;
    this.dismiss();
    await action.undo();
    return true;
  }

  dismiss() {
    if (this.#timer !== undefined) this.#clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#pending = null;
  }
}
