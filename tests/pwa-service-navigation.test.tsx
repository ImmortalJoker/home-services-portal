import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Portal } from '../src/Portal';
import { serviceWebTarget } from '../src/service-navigation';

function environment(android: boolean, standalone: boolean, userAgent?: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent ?? (android
    ? 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/144.0 Mobile Safari/537.36'
    : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/144.0 Safari/537.36'));
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(display-mode: standalone)' && standalone,
    media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps Android standalone service navigation in the current browsing context', () => {
  environment(true, true);
  render(<Portal config={{ portalName: 'Test', services: [
    { id: 'kiwix', name: 'Kiwix', url: 'https://kiwix.example.test/' },
  ] }} />);
  const link = screen.getByRole('link', { name: 'Open Kiwix' });
  expect(link.getAttribute('target')).toBe('_self');
  expect(link.getAttribute('rel')).toBe('noreferrer');
  expect(link.getAttribute('href')).toBe('https://kiwix.example.test/');
});

it.each([
  ['Android browser tab', true, false, undefined],
  ['desktop browser tab', false, false, undefined],
  ['desktop standalone', false, true, undefined],
  ['iOS standalone', false, true, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1'],
] as const)('preserves isolated new windows for %s', (_name, android, standalone, ua) => {
  environment(android, standalone, ua);
  render(<Portal config={{ portalName: 'Test', services: [
    { id: 'kiwix', name: 'Kiwix', url: 'https://kiwix.example.test/' },
  ] }} />);
  const link = screen.getByRole('link', { name: 'Open Kiwix' });
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noreferrer');
});

it('falls back to separate windows without a display-mode API', () => {
  environment(true, true);
  vi.stubGlobal('matchMedia', undefined);
  expect(serviceWebTarget()).toBe('_blank');
});

it('falls back safely without a browser identity', () => {
  vi.stubGlobal('navigator', undefined);
  expect(serviceWebTarget()).toBe('_blank');
});

it('preserves native app intents while applying the PWA policy to web and OPDS links', () => {
  environment(true, true);
  render(<Portal config={{ portalName: 'Test', services: [
    { id: 'books-library', name: 'Books', url: 'https://books.example.test/', opdsUrl: 'https://books.example.test/opds' },
    { id: 'immich', name: 'Photos', url: 'https://photos.example.test/', launch: { android: 'immich' } },
  ] }} />);
  for (const name of ['Open Books', 'Open Books OPDS', 'Open Photos in browser']) {
    const link = screen.getByRole('link', { name });
    expect(link.getAttribute('target')).toBe('_self');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  }
  const native = screen.getByRole('link', { name: 'Open Photos in Immich' });
  expect(native.getAttribute('href')).toBe('intent://#Intent;scheme=immich;package=app.alextran.immich;S.browser_fallback_url=https%3A%2F%2Fphotos.example.test%2F;end');
  expect(native.hasAttribute('target')).toBe(false);
  expect(native.getAttribute('referrerpolicy')).toBe('no-referrer');
});

it('keeps Transmission full-page navigation in the Android standalone context', async () => {
  environment(true, true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    downloading: 0, active: 0, total: 0, percent: null, download_bps: 0, upload_bps: 0,
  }) }));
  render(<Portal config={{ portalName: 'Test', services: [
    { id: 'transmission', name: 'Transmission', url: 'https://transmission.example.test/' },
  ] }} />);
  await screen.findByText('No torrents');
  expect(screen.getByRole('link', { name: 'Open Transmission' }).getAttribute('target')).toBe('_self');
  fireEvent.click(screen.getByRole('button', { name: 'Web controls' }));
  const fullPage = screen.getByRole('link', { name: 'open in a full page' });
  expect(fullPage.getAttribute('target')).toBe('_self');
  expect(fullPage.getAttribute('rel')).toBe('noreferrer');
});
