import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectMobilePlatform, getAppLaunch, validateLaunch } from '../deploy/authentik/portal/launch.mjs';
import { Portal } from '../src/Portal';
import { validateConfig } from '../src/config';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const url = 'https://media.example.test:8451/?a=1&b=two#photos';

describe('fixed mobile launch presets', () => {
  it('encodes the exact existing web fallback in Android intents', () => {
    const app = getAppLaunch({ id: 'immich', url, launch: { android: 'immich' } }, 'android');
    expect(app?.href).toBe(`intent://#Intent;scheme=immich;package=app.alextran.immich;S.browser_fallback_url=${encodeURIComponent(url)};end`);
  });
  it('uses the tested iPhone clients and keeps unsupported platforms web-only', () => {
    expect(getAppLaunch({ id: 'audiobookshelf', url, launch: { ios: 'audiobooth' } }, 'ios')?.href).toBe('audiobooth://');
    expect(getAppLaunch({ id: 'jellyfin', url, launch: { ios: 'jellyfin-mobile' } }, 'ios')?.href).toBe('org.jellyfin.expo://');
    expect(getAppLaunch({ id: 'jellyfin', url, launch: { ios: 'jellyfin-mobile' } }, 'android')).toBeNull();
    expect(getAppLaunch({ id: 'immich', url, launch: { ios: 'immich' } }, null)).toBeNull();
  });
  it.each([
    { ios: 'javascript:alert(1)' }, { ios: 'data:text/html,unsafe' }, { ios: 'constructor' },
    { ios: 'https://my.immich.app.evil/' }, { desktop: 'immich' }, { android: 'audiobooth' },
    { ios: { href: 'immich://' } }, {}, [], null,
  ])('rejects arbitrary launch configuration: %j', (launch) => {
    expect(() => validateLaunch(launch, 'immich', url)).toThrow();
    expect(() => validateConfig({ portalName: 'Test', services: [{ id: 'immich', name: 'Photos', url, launch }] })).toThrow();
  });
  it('rejects mismatched services and unsafe app fallbacks', () => {
    expect(() => validateLaunch({ ios: 'immich' }, 'transmission', url)).toThrow();
    for (const unsafe of ['http://example.test/', 'https://user:password@example.test/', '/relative']) {
      expect(() => validateLaunch({ ios: 'immich' }, 'immich', unsafe)).toThrow();
    }
  });
  it('recognizes mobile browsers including iPad desktop mode', () => {
    const device = { userAgent: '', platform: '', maxTouchPoints: 0 };
    expect(detectMobilePlatform({ ...device, userAgent: 'Android Chrome' })).toBe('android');
    expect(detectMobilePlatform({ ...device, userAgent: 'iPhone Safari' })).toBe('ios');
    expect(detectMobilePlatform({ ...device, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
    expect(detectMobilePlatform({ ...device, platform: 'MacIntel' })).toBeNull();
  });
  it('renders separate app and web anchors without nesting or automatic navigation', () => {
    vi.stubGlobal('navigator', { userAgent: 'iPhone Safari', platform: 'iPhone', maxTouchPoints: 5 });
    const { container } = render(<Portal config={{ portalName: 'Test', services: [{ id: 'audiobookshelf', name: 'Audiobooks', url, launch: { ios: 'audiobooth' } }] }} />);
    const app = screen.getByRole('link', { name: 'Open Audiobooks in AudioBooth' });
    expect(app.getAttribute('href')).toBe('audiobooth://');
    expect(app.hasAttribute('target')).toBe(false);
    expect(screen.getByRole('link', { name: 'Open Audiobooks in browser' }).getAttribute('href')).toBe(url);
    expect(container.querySelector('a a')).toBeNull();
  });
});
