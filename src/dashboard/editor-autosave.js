function clone(value) {
  return structuredClone(value);
}

function defaultEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createEditorAutosave({
  initial,
  save,
  equals = defaultEquals,
  delay = 500,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onStateChange = () => {},
}) {
  let baseline = clone(initial);
  let draft = clone(initial);
  let timer = null;
  let activeFlush = null;
  let state = 'idle';

  function setState(next, error) {
    state = next;
    onStateChange({ state: next, ...(error === undefined ? {} : { error }) });
  }

  function schedule() {
    if (timer !== null) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      timer = null;
      void flush().catch(() => {});
    }, delay);
  }

  async function runFlush() {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }

    while (!equals(draft, baseline)) {
      const snapshot = clone(draft);
      setState('saving');
      try {
        const saved = await save(snapshot);
        baseline = clone(saved);
        setState(equals(draft, baseline) ? 'saved' : 'dirty');
      } catch (error) {
        setState(error?.name === 'ConflictError' ? 'conflict' : 'error', error);
        throw error;
      }
    }
    return clone(baseline);
  }

  function flush() {
    if (activeFlush !== null) return activeFlush;
    activeFlush = runFlush();
    activeFlush = activeFlush.finally(() => {
      activeFlush = null;
    });
    return activeFlush;
  }

  return {
    reset(next) {
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      baseline = clone(next);
      draft = clone(next);
      setState('idle');
    },

    update(next) {
      draft = clone(next);
      if (equals(draft, baseline)) {
        if (timer !== null) clearTimeoutFn(timer);
        timer = null;
        setState('idle');
        return;
      }
      setState('dirty');
      schedule();
    },

    flush,

    flushOnExternalChange() {
      if (state !== 'dirty' && state !== 'saving') return Promise.resolve(clone(baseline));
      return flush();
    },

    cancel() {
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
    },

    getState() {
      return state;
    },
  };
}
