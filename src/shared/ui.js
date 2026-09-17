export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function showToast(element, message, { duration = 5000 } = {}) {
  element.textContent = message;
  element.hidden = false;
  clearTimeout(element._toastTimer);
  element._toastTimer = setTimeout(() => { element.hidden = true; }, duration);
}

export function runViewAction(action, { signal = null, onError = () => {} } = {}) {
  if (signal?.aborted) return Promise.resolve();
  return Promise.resolve()
    .then(action)
    .catch((error) => {
      if (signal?.aborted || error?.name === 'AbortError') return;
      return Promise.resolve()
        .then(() => onError(error))
        .catch(() => {});
    });
}

export function restoreFocus(element) {
  element?.focus();
}
