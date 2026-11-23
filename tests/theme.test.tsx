import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PortalApp } from '../src/PortalApp';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';

const themeCss = readFileSync('src/theme.css', 'utf8');
const controlCss = readFileSync('src/style.css', 'utf8');

const preferenceKey = 'home-services-portal:theme';

function systemTheme(dark: boolean) {
  const media = Object.assign(new EventTarget(), { matches: dark });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media));
  return (matches: boolean) => {
    media.matches = matches;
    act(() => media.dispatchEvent(new Event('change')));
  };
}

const control = () => screen.getByRole<HTMLButtonElement>('button', { name: /Switch to (light|dark) theme/ });
const choose = (value: 'light' | 'dark') => {
  if (theme() !== value) fireEvent.click(control());
};
const theme = () => document.documentElement.dataset.theme;

beforeEach(() => {
  vi.stubEnv('VITE_PORTAL_PUBLIC_DEMO', 'true');
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

it('offers an icon-only action button that toggles and saves explicit themes', () => {
  systemTheme(false);
  render(<PortalApp />);
  const button = screen.getByRole('button', { name: 'Switch to dark theme' });
  expect(button.getAttribute('type')).toBe('button');
  expect(button.getAttribute('title')).toBe('Switch to dark theme');
  expect(button.textContent).toBe('');
  expect(screen.queryByText('Theme')).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Theme' })).toBeNull();
  const moon = button.querySelector('svg');
  expect(moon?.getAttribute('aria-hidden')).toBe('true');
  expect(moon?.getAttribute('focusable')).toBe('false');
  expect(moon?.querySelector('path')).not.toBeNull();
  expect(localStorage.getItem(preferenceKey)).toBeNull();

  fireEvent.click(button);
  expect(theme()).toBe('dark');
  expect(localStorage.getItem(preferenceKey)).toBe('dark');
  expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBe(button);
  expect(button.getAttribute('title')).toBe('Switch to light theme');
  expect(button.querySelector('svg circle')).not.toBeNull();

  fireEvent.click(button);
  expect(theme()).toBe('light');
  expect(localStorage.getItem(preferenceKey)).toBe('light');
  expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBe(button);
});

it('defaults to System and updates the action icon with OS changes until clicked', () => {
  const changeSystem = systemTheme(true);
  render(<PortalApp />);
  const button = screen.getByRole('button', { name: 'Switch to light theme' });
  expect(button.querySelector('svg circle')).not.toBeNull();
  expect(theme()).toBe('dark');
  expect(localStorage.length).toBe(0);
  changeSystem(false);
  expect(theme()).toBe('light');
  expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBe(button);
  expect(button.getAttribute('title')).toBe('Switch to dark theme');
  expect(button.querySelector('svg circle')).toBeNull();
  expect(localStorage.length).toBe(0);
  changeSystem(true);
  expect(theme()).toBe('dark');
  expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBe(button);
  expect(button.querySelector('svg circle')).not.toBeNull();
  fireEvent.click(button);
  expect(theme()).toBe('light');
  changeSystem(false);
  changeSystem(true);
  expect(theme()).toBe('light');
  expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBe(button);
  expect(localStorage.getItem(preferenceKey)).toBe('light');
  expect(localStorage.length).toBe(1);
});

it('keeps the icon button compact with the application stylesheet cascade', () => {
  systemTheme(false);
  const styles = document.createElement('style');
  styles.textContent = `${themeCss}\n${controlCss}`;
  document.head.append(styles);
  try {
    render(<div id="root"><PortalApp /></div>);
    const style = getComputedStyle(control());
    expect(style.width).toBe('40px');
    expect(style.height).toBe('40px');
    expect(style.minHeight).toBe('40px');
    expect(style.padding).toBe('0px');
  } finally {
    styles.remove();
  }
});

it('supports native keyboard focus and Enter/Space activation', async () => {
  systemTheme(false);
  const user = userEvent.setup();
  render(<PortalApp />);
  await user.tab();
  await user.tab();
  const button = control();
  expect(document.activeElement).toBe(button);
  await user.keyboard('{Enter}');
  expect(theme()).toBe('dark');
  expect(document.activeElement).toBe(button);
  await user.keyboard(' ');
  expect(theme()).toBe('light');
  expect(localStorage.getItem(preferenceKey)).toBe('light');
});

it('restores the saved light override on remount even when the OS prefers dark', () => {
  systemTheme(true);
  const first = render(<PortalApp />);
  choose('light');
  first.unmount();
  render(<PortalApp />);
  expect(control().getAttribute('aria-label')).toBe('Switch to dark theme');
  expect(theme()).toBe('light');
});

it('ignores invalid preferences and supports overrides without matchMedia', () => {
  localStorage.setItem(preferenceKey, 'invalid');
  vi.stubGlobal('matchMedia', undefined);
  render(<PortalApp />);
  expect(theme()).toBe('light');
  expect(control().getAttribute('aria-label')).toBe('Switch to dark theme');
  choose('dark');
  expect(theme()).toBe('dark');
  choose('light');
  expect(theme()).toBe('light');
});

it('keeps working when accessing storage throws', () => {
  systemTheme(true);
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
  render(<PortalApp />);
  expect(theme()).toBe('dark');
  expect(control().getAttribute('aria-label')).toBe('Switch to light theme');
  choose('light');
  expect(theme()).toBe('light');
  choose('dark');
  expect(theme()).toBe('dark');
});

it('keeps the theme control usable when matchMedia throws', () => {
  vi.stubGlobal('matchMedia', () => { throw new Error('unsupported'); });
  render(<PortalApp />);
  expect(theme()).toBe('light');
  choose('dark');
  expect(theme()).toBe('dark');
});

it('supports a theme override on an authenticated access-denied screen', async () => {
  vi.stubEnv('VITE_PORTAL_PUBLIC_DEMO', 'false');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 403 }));
  render(<PortalApp />);
  await screen.findByRole('alert');
  choose('dark');
  expect(theme()).toBe('dark');
  expect(screen.getByRole('heading', { name: 'Portal access unavailable' })).toBeTruthy();
});

it('preserves live metric values and their original time across a theme change and failed refresh', async () => {
  vi.stubEnv('VITE_PORTAL_PUBLIC_DEMO', 'false');
  const jsonResponse = (payload: unknown) => ({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => payload,
  });
  const updatedAt = 1_760_000_000;
  const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
    portalName: 'Домашні сервіси',
    identity: { username: 'test-user', name: 'Олена', email: '', role: 'Owner' },
    services: [
      { id: 'runtime-book', name: 'Бібліотека', url: 'https://library.example.test/' },
      { id: 'system-metrics', name: 'System metrics', url: '/api/system-status', widget: 'system-status', accessGroups: ['Portal - Owner'] },
    ],
  })).mockResolvedValueOnce(jsonResponse({
    cpu_percent: 22, memory_percent: 42, disk_percent: 61, load_1m: 1.2, logical_cores: 8,
    memory_used_bytes: 42, memory_total_bytes: 100, disk_free_bytes: 39, disk_total_bytes: 100,
    uptime_seconds: 100, updated_at: updatedAt,
  })).mockRejectedValueOnce(new Error('offline'));
  vi.stubGlobal('fetch', fetchMock);

  render(<PortalApp />);
  const meter = await screen.findByText('22%');
  const originalTime = new Date(updatedAt * 1000).toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
  expect(screen.getByRole('link', { name: 'Open Бібліотека' })).toBeTruthy();
  expect(screen.getByText(originalTime)).toBeTruthy();

  choose('light');
  expect(theme()).toBe('light');
  choose('dark');
  expect(theme()).toBe('dark');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByText('22%')).toBe(meter);

  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  const stale = await screen.findByText(/latest update failed/i);
  expect(stale.closest('[data-stale="true"]')).toBeTruthy();
  expect(screen.getByText('22%')).toBe(meter);
  expect(screen.getByText(originalTime)).toBeTruthy();
});
