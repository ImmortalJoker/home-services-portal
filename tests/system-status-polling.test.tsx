import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SystemStatusWidget } from '../src/SystemStatusWidget';

const status = {
  cpu_percent: 21.5, load_1m: 1.2, logical_cores: 8, memory_percent: 42,
  memory_used_bytes: 4_500_000_000, memory_total_bytes: 10_000_000_000, disk_percent: 61,
  disk_free_bytes: 39_000_000_000, disk_total_bytes: 100_000_000_000, uptime_seconds: 86_400, updated_at: 1_760_000_000,
};
const ok = { ok: true, status: 200, headers: { get: (): string => 'application/json' }, json: async () => status };

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

const service = { id: 'system-metrics', name: 'System status', url: '/api/status', widget: 'system-status' } as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it('reserves labeled meter and footer space while awaiting the first reading', async () => {
  const pending = deferred<typeof ok>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise));
  render(<SystemStatusWidget service={service} />);
  expect(screen.getByRole('status').textContent).toMatch(/loading system status/i);
  for (const label of ['CPU', 'Memory', 'Disk', 'Load', 'Uptime', 'Updated']) {
    expect(screen.getByText(label)).toBeVisible();
  }
  expect(screen.getByRole('link', { name: /view raw JSON/i })).toBeVisible();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.queryByText(/\d/)).toBeNull();

  await act(async () => pending.resolve(ok));
  expect(screen.getByText('22%')).toBeVisible();
});

it('shows a retryable initial failure without measurements', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<SystemStatusWidget service={service} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/refresh to try again/i);
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.queryByText(/\d/)).toBeNull();
  expect(screen.getByText('CPU')).toBeVisible();
});

const updated = new Date(status.updated_at * 1000).toLocaleTimeString([], {
  hour: 'numeric', minute: '2-digit', second: '2-digit',
});

function expectPreviousReading() {
  for (const value of ['22%', '42%', '61%']) expect(screen.getByText(value)).toBeVisible();
  expect(screen.getByText(updated)).toBeVisible();
  expect(screen.getAllByRole('progressbar')).toHaveLength(3);
}

it.each(['manual', 'timer', 'visibility'])('retains the reading during a pending %s refresh', async (trigger) => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const pending = deferred<typeof ok>();
  const fetchMock = vi.fn().mockResolvedValueOnce(ok).mockReturnValue(pending.promise);
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => { render(<SystemStatusWidget service={service} />); });

  if (trigger === 'manual') {
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  } else if (trigger === 'timer') {
    visibility.mockReturnValue(true);
    act(() => vi.advanceTimersByTime(15_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue(false);
    act(() => vi.advanceTimersByTime(15_000));
  } else {
    fireEvent(document, new Event('visibilitychange'));
  }

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expectPreviousReading();
  expect(screen.getByRole('status')).toHaveTextContent(/updating.*previous reading/i);
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  expect(screen.queryByText(/live status/i)).toBeNull();

  fireEvent(document, new Event('visibilitychange'));
  act(() => vi.advanceTimersByTime(15_000));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();

  await act(async () => pending.resolve({ ...ok, json: async () => ({
    ...status, cpu_percent: 33, updated_at: status.updated_at + 15,
  }) }));
  expect(screen.getByText('33%')).toBeVisible();
  expect(screen.queryByText(updated)).toBeNull();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
});

it('keeps an invalid refresh stale until a validated measurement succeeds', async () => {
  const pending = deferred<typeof ok>();
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(ok)
    .mockResolvedValueOnce({ ...ok, json: async () => ({}) })
    .mockReturnValueOnce(pending.promise));
  render(<SystemStatusWidget service={service} />);
  await screen.findByText('22%');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh' })));
  expect(screen.getByRole('status')).toHaveTextContent(/latest update failed/i);
  expectPreviousReading();

  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(screen.getByRole('status')).toHaveTextContent(/updating.*stale/i);
  expectPreviousReading();

  await act(async () => pending.resolve(ok));
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  expectPreviousReading();
});

it.each([
  { name: '401', response: { ...ok, ok: false, status: 401 } },
  { name: '403', response: { ...ok, ok: false, status: 403 } },
  { name: 'login redirect', response: { ...ok, ok: false, status: 0, type: 'opaqueredirect' } },
])('clears the previous reading after $name', async ({ response }) => {
  const fetchMock = vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  render(<SystemStatusWidget service={service} />);
  await screen.findByText('22%');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/access/i);
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: 'manual' });
  expect(screen.queryByText('22%')).toBeNull();
  expect(screen.queryByText(updated)).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
});

it.each([{ id: 'replacement' }, { url: '/api/replacement-status' }])(
  'discards readings and ignores late responses after a service change (%j)',
  async (change) => {
    const late = deferred<typeof status>();
    const pending = deferred<typeof ok>();
    const fetchMock = vi.fn().mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ ...ok, json: () => late.promise })
      .mockReturnValueOnce(pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<SystemStatusWidget service={service} />);
    await screen.findByText('22%');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh' })));

    rerender(<SystemStatusWidget service={{ ...service, ...change }} />);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(updated)).toBeNull();
    await act(async () => late.resolve({ ...status, cpu_percent: 99 }));
    expect(screen.queryByText('99%')).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();

    await act(async () => pending.resolve(ok));
    expectPreviousReading();
  },
);

it('aborts and cleans up on unmount and cannot restore readings on remount', async () => {
  vi.useFakeTimers();
  const late = deferred<typeof ok>();
  const pending = deferred<typeof ok>();
  const fetchMock = vi.fn().mockResolvedValueOnce(ok).mockReturnValueOnce(late.promise)
    .mockReturnValueOnce(pending.promise);
  vi.stubGlobal('fetch', fetchMock);
  const first = render(<SystemStatusWidget service={service} />);
  await act(async () => {});
  expectPreviousReading();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  first.unmount();
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  fireEvent(document, new Event('visibilitychange'));
  act(() => vi.advanceTimersByTime(15_000));
  expect(fetchMock).toHaveBeenCalledTimes(2);

  render(<SystemStatusWidget service={service} />);
  await act(async () => late.resolve(ok));
  expect(screen.queryByText(updated)).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent(/loading system status/i);
});

it('shares one request when a poll starts just before a manual refresh', async () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const pending = deferred<typeof ok>();
  const fetchMock = vi.fn().mockResolvedValueOnce(ok).mockReturnValue(pending.promise);
  vi.stubGlobal('fetch', fetchMock);
  render(<SystemStatusWidget service={service} />);
  await screen.findByText('22%');
  const button = screen.getByRole('button', { name: 'Refresh' });

  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    button.click();
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
  expectPreviousReading();
  await act(async () => pending.resolve(ok));
  expect(button).toBeEnabled();
});
