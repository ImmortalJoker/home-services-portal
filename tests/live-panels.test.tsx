import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppRecommendations } from '../src/AppRecommendations';
import { TransmissionCard } from '../src/TransmissionCard';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('preselects the detected platform and lets the user see the other apps', () => {
  vi.stubGlobal('navigator', { userAgent: 'Android Chrome', platform: 'Linux', maxTouchPoints: 5 });
  render(<AppRecommendations services={[{ id: 'audiobookshelf', name: 'Audio', url: 'https://audio.example.test/', guides: {
    ios: { title: 'AudioBooth', downloadUrl: 'https://apps.apple.com/app/id6753017503', steps: ['Use SSO.'] },
    android: { title: 'Audiobookshelf', downloadUrl: 'https://play.google.com/store/apps/details?id=com.audiobookshelf.app', steps: ['Use SSO.'] },
  } }]} />);
  expect(screen.getByRole('button', { name: 'Android' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('link', { name: 'Audiobookshelf' }).getAttribute('href')).toContain('play.google.com');
  expect(screen.queryByRole('link', { name: 'Immich' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'iPhone & iPad' }));
  expect(screen.getByRole('link', { name: 'AudioBooth' }).getAttribute('href')).toContain('apps.apple.com');
});
it('loads summary immediately and mounts the iframe only while expanded', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ active: 2, total: 4, percent: 75, download_bps: 1048576, upload_bps: 1024 }) }));
  const { container } = render(<TransmissionCard service={{ id: 'transmission', name: 'Transmission', url: 'https://downloads.example.test/transmission/web/' }} />);
  expect(await screen.findByText('2 running / 4 total')).toBeTruthy();
  expect(screen.getByText('75% overall')).toBeTruthy();
  expect(container.querySelector('iframe')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Web controls' }));
  expect(screen.getByTitle('Transmission web controls').getAttribute('src')).toBe('https://downloads.example.test/transmission/web/');
  fireEvent.click(screen.getByRole('button', { name: 'Web controls' }));
  await waitFor(() => expect(container.querySelector('iframe')).toBeNull());
});
