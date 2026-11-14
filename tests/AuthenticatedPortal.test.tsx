import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedPortal } from '../src/AuthenticatedPortal';

const payload = {
  portalName: 'Household Portal',
  identity: { username: 'owner-user', name: 'Owner User', email: 'owner@example.invalid', role: 'Owner', groups: ['Portal - Public', 'Portal - Family', 'Portal - Owner'] },
  services: [
    { id: 'shared', name: 'Shared demo', url: '/sample', accessGroups: ['Portal - Public'] },
    { id: 'owner', name: 'Owner diagnostics', url: '/owner-check', accessGroups: ['Portal - Owner'] },
    { id: 'system-metrics', name: 'System status', description: 'Current host health.', url: '/api/status', accessGroups: ['Portal - Owner'], widget: 'system-status' },
  ],
};

const systemStatus = {
  cpu_percent: 21.5,
  load_1m: 1.2,
  logical_cores: 8,
  memory_percent: 42,
  memory_used_bytes: 4_500_000_000,
  memory_total_bytes: 10_000_000_000,
  disk_percent: 61,
  disk_free_bytes: 39_000_000_000,
  disk_total_bytes: 100_000_000_000,
  uptime_seconds: 86_400,
  updated_at: 1_760_000_000,
};

function response(status: number, body?: unknown, contentType = 'application/json') {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
    json: async () => body,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AuthenticatedPortal', () => {
  it('renders the authenticated identity and server-authorized services without the browser editor', async () => {
    const fetchMock = vi.fn((input: string | URL) => Promise.resolve(
      String(input).includes('/api/system-status')
        ? response(200, systemStatus)
        : response(200, payload),
    ));
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthenticatedPortal />);
    expect(await screen.findByRole('heading', { name: 'Household Portal' })).toBeTruthy();
    expect(screen.getByText('Owner User')).toBeTruthy();
    expect(screen.getByText('Owner access')).toBeTruthy();
    expect(screen.getByRole('link', { name: /sign out/i }).getAttribute('href')).toBe('/outpost.goauthentik.io/sign_out');
    expect(screen.getByRole('link', { name: /Owner diagnostics/ }).getAttribute('href')).toBe('/owner-check');
    expect(await screen.findByRole('region', { name: 'System status' })).toBeTruthy();
    expect(await screen.findByText('42%')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/system-status'))).toBe(true);
    expect(screen.queryByRole('button', { name: /customize services/i })).toBeNull();
  });

  it('shows Pending members an atrium message with no service links', async () => {
    const pendingPayload = {
      portalName: 'Household Portal',
      identity: {
        username: 'waiting-user',
        name: 'Waiting User',
        email: 'waiting@example.invalid',
        role: 'Pending',
        groups: ['Portal - Pending'],
      },
      services: [],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, pendingPayload)));
    render(<AuthenticatedPortal />);
    expect(await screen.findByRole('heading', { name: 'Your access is pending' })).toBeTruthy();
    expect(screen.getByText(/the owner must approve your access/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /sign out/i }).getAttribute('href')).toBe('/outpost.goauthentik.io/sign_out');
    expect(screen.queryByRole('link', { name: /Shared demo|Owner diagnostics/ })).toBeNull();
  });

  it('shows a denial state instead of falling back to public demo config on authorization failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(403, { error: 'Portal access denied.' })));
    render(<AuthenticatedPortal />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/not assigned to an access group/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /customize services/i })).toBeNull();
  });

  it('fails closed when the private identity endpoint is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(404, undefined, 'text/html')));
    render(<AuthenticatedPortal />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/could not load your portal/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /customize services/i })).toBeNull();
  });

  it('does not show the public demo when the session request returns an HTML login page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, '<html>Sign in</html>', 'text/html')));
    render(<AuthenticatedPortal />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/could not load your portal/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /customize services/i })).toBeNull();
  });

  it('shows a useful error when the private portal API fails unexpectedly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));
    render(<AuthenticatedPortal />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/could not load your portal/i)).toBeTruthy();
  });
});
