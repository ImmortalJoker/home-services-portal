import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { applyTheme, getSystemTheme, readThemePreference, saveThemePreference, type ThemePreference } from './theme';

const ThemeContext = createContext<{
  preference: ThemePreference;
  choose: (next: ThemePreference) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readThemePreference);

  useLayoutEffect(() => {
    const media = preference === 'system' ? getSystemTheme() : undefined;
    const update = () => applyTheme(preference, media);
    update();
    if (!media) return;
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener?.(update);
    return () => media.removeListener?.(update);
  }, [preference]);

  function choose(next: ThemePreference) {
    saveThemePreference(next);
    setPreference(next);
  }

  return <ThemeContext.Provider value={{ preference, choose }}>{children}</ThemeContext.Provider>;
}

export function ThemeControl() {
  const theme = useContext(ThemeContext);
  if (!theme) return null;

  return <label className="theme-control">
    <span>Theme</span>
    <select value={theme.preference} onChange={event => theme.choose(event.currentTarget.value as ThemePreference)}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>;
}
