export const THEME_SETTINGS = ['system', 'light', 'dark'];

export function resolveTheme(theme, prefersDark) {
  if (!THEME_SETTINGS.includes(theme)) return 'light';
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

export function applyTheme(theme, root = document.documentElement) {
  const prefersDark = typeof matchMedia === 'function'
    && matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = resolveTheme(theme, prefersDark);
  root.dataset.theme = resolved;
  return resolved;
}
