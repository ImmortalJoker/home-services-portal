import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { validateConfig } from '../src/config';
import { AppRecommendations } from '../src/AppRecommendations';
import { Portal } from '../src/Portal';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const guide = { title: 'Reader', connectionUrl: 'https://books.example.test/opds', connectionLabel: 'Catalog address', steps: ['Open Network Library.', 'Paste the address.'] };
it('copies only the configured address after a user click', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5, clipboard: { writeText } });
  render(<AppRecommendations services={[{ id: 'books', name: 'Books', url: 'https://books.example.test/', guides: { ios: guide } }]} />);
  expect(screen.getByText('Open Network Library.')).toBeTruthy();
  expect(writeText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(guide.connectionUrl));
  expect(await screen.findByText('Copied')).toBeTruthy();
});
it.each([
  { ios: { ...guide, downloadUrl: 'javascript:alert(1)' } },
  { ios: { ...guide, connectionUrl: 'https://user:secret@example.test/' } },
  { ios: { ...guide, apiKey: 'forbidden-field' } },
  { ios: { ...guide, steps: [] } },
  { desktop: guide },
])('rejects unsafe guide metadata in frontend validation', guides => {
  expect(() => validateConfig({ portalName: 'Test', services: [{ id: 'books', name: 'Books', url: 'https://books.example.test/', guides }] })).toThrow();
});
it('renders the network route explicitly, with a compact header and a separate service area', () => {
  render(<Portal config={{ portalName: 'Home Services', services: [] }} connection="tailscale" />);
  expect(screen.getByRole('status', { name: 'Tailscale' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Home Services' }).closest('header')?.classList.contains('portal-header')).toBe(true);
});
