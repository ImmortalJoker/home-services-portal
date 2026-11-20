import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SystemStatusWidget } from '../src/SystemStatusWidget';

const status = {
  cpu_percent: 21.5, load_1m: 1.2, logical_cores: 8, memory_percent: 42,
  memory_used_bytes: 4_500_000_000, memory_total_bytes: 10_000_000_000, disk_percent: 61,
  disk_free_bytes: 39_000_000_000, disk_total_bytes: 100_000_000_000, uptime_seconds: 86_400, updated_at: 1_760_000_000,
};
const ok = { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => status };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps the last reading visible during background polls and marks it stale on failure', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(ok);
  vi.stubGlobal('fetch', fetchMock);
  render(<SystemStatusWidget service={{ id: 'system-metrics', name: 'System status', url: '/api/status', widget: 'system-status' }} />);
  expect(await screen.findByText('CPU')).toBeTruthy();

  // Next poll fails: the meters must stay and no full "Loading" state may replace them.
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(await screen.findByText(/latest update failed/i)).toBeTruthy();
  expect(screen.getByText('CPU')).toBeTruthy();
  expect(screen.queryByText('Loading system status…')).toBeNull();
  expect(screen.queryByText(/system status is unavailable/i)).toBeNull();

  // A later successful poll clears the stale notice.
  fetchMock.mockResolvedValueOnce(ok);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await vi.waitFor(() => expect(screen.queryByText(/latest update failed/i)).toBeNull());
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
});
