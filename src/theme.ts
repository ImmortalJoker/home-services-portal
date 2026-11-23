export type ThemePreference = 'light' | 'dark' | 'system';

const preferenceKey = 'home-services-portal:theme';
const systemQuery = '(prefers-color-scheme: dark)';

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(preferenceKey);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // The browser can block storage even when the API exists.
  }
  return 'system';
}

export function saveThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') window.localStorage.removeItem(preferenceKey);
    else window.localStorage.setItem(preferenceKey, preference);
  } catch {
    // The selection still applies for this visit.
  }
}

export function getSystemTheme() {
  try {
    return window.matchMedia?.(systemQuery);
  } catch {
    return undefined;
  }
}

export function applyTheme(preference: ThemePreference, system?: MediaQueryList) {
  const root = document.documentElement;
  root.dataset.theme = preference === 'system' ? (system?.matches ? 'dark' : 'light') : preference;
  const color = getComputedStyle(root).getPropertyValue('--portal-page').trim();
  if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}
