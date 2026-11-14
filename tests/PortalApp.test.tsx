import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortalApp } from '../src/PortalApp';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('PortalApp build mode', () => {
  it('renders the editable static demo only when the public build flag is enabled', () => {
    vi.stubEnv('VITE_PORTAL_PUBLIC_DEMO', 'true');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<PortalApp />);

    expect(screen.getByRole('button', { name: /customize services/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Home Services Portal' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /sign out/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the authenticated portal by default for private builds', async () => {
    vi.stubEnv('VITE_PORTAL_PUBLIC_DEMO', 'false');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
      headers: { get: () => 'text/html' },
      json: async () => undefined,
    }));

    render(<PortalApp />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/could not load your portal/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /customize services/i })).toBeNull();
  });
});
