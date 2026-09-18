const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function createShortcutHandler({ navigate, focusQuickAdd, focusSearch, isBlocked = () => false }) {
  const actions = {
    n: focusQuickAdd,
    f: focusSearch,
    t: () => navigate('today'),
    w: () => navigate('week'),
    m: () => navigate('month'),
  };
  return (event) => {
    if (event.defaultPrevented || isBlocked() || EDITABLE_TAGS.has(event.target?.tagName)) return;
    const action = actions[event.key?.toLowerCase()];
    if (action === undefined) return;
    event.preventDefault();
    action();
  };
}
