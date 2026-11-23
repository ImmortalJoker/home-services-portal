import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { applyTheme, getSystemTheme, readThemePreference, saveThemePreference, type ThemePreference } from './theme';

const ThemeContext = createContext<{
  effective: 'light' | 'dark';
  choose: (next: ThemePreference) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readThemePreference);
  const [effective, setEffective] = useState<'light' | 'dark'>('light');

  useLayoutEffect(() => {
    const media = preference === 'system' ? getSystemTheme() : undefined;
    const update = () => {
      applyTheme(preference, media);
      setEffective(preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference);
    };
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

  return <ThemeContext.Provider value={{ effective, choose }}>{children}</ThemeContext.Provider>;
}

export function ThemeControl() {
  const theme = useContext(ThemeContext);
  if (!theme) return null;

  const next = theme.effective === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} theme`;

  return <button className="theme-control" type="button" aria-label={label} title={label}
    onClick={() => theme.choose(next)}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {next === 'dark'
        ? <path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z" />
        : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>}
    </svg>
  </button>;
}
