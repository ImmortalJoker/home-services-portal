import { useEffect, useRef, useState } from 'react';
import type { ServiceItem } from './config';
import './system-status-widget.css';

interface SystemStatus {
  cpu_percent: number;
  load_1m: number;
  logical_cores: number;
  memory_percent: number;
  memory_used_bytes: number;
  memory_total_bytes: number;
  disk_percent: number;
  disk_free_bytes: number;
  disk_total_bytes: number;
  uptime_seconds: number;
  updated_at: number;
}

type StatusView =
  | { state: 'loading' }
  | { state: 'loaded'; status: SystemStatus; stale: boolean }
  | { state: 'error'; accessDenied?: boolean };

function isSystemStatus(value: unknown): value is SystemStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const fields = [
    'cpu_percent', 'load_1m', 'logical_cores', 'memory_percent',
    'memory_used_bytes', 'memory_total_bytes', 'disk_percent',
    'disk_free_bytes', 'disk_total_bytes', 'uptime_seconds', 'updated_at',
  ];
  return fields.every((field) => typeof candidate[field] === 'number' && Number.isFinite(candidate[field])) &&
    Number(candidate.logical_cores) > 0 && Number(candidate.memory_total_bytes) > 0 &&
    Number(candidate.disk_total_bytes) > 0;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`status-skeleton ${className}`} aria-hidden="true" />;
}

function MetricMeter({ label, percent, detail, loading }: {
  label: string; percent?: number; detail?: string; loading: boolean;
}) {
  return (
    <div className="status-meter">
      <div className="status-meter-heading">
        <span>{label}</span>
        {percent === undefined ? loading && <Skeleton /> : <strong>{Math.round(percent)}%</strong>}
      </div>
      {percent === undefined ? <span className="status-meter-empty-track" aria-hidden="true">{loading && <Skeleton />}</span> :
        <progress max={100} value={Math.min(100, Math.max(0, percent))} aria-label={`${label} usage`} />}
      <small>{detail ?? (loading && <Skeleton className="status-skeleton-detail" />)}</small>
    </div>
  );
}

export function SystemStatusWidget({ service }: { service: ServiceItem }) {
  return <SystemStatusReading key={JSON.stringify([service.id, service.url])} service={service} />;
}

function SystemStatusReading({ service }: { service: ServiceItem }) {
  const [view, setView] = useState<StatusView>({ state: 'loading' });
  const refresh = useRef<() => void>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let inFlight = false;

    async function load() {
      if (inFlight) return;
      inFlight = true;
      setRefreshing(true);
      setView((current) => current.state === 'loaded' ? current : { state: 'loading' });
      try {
        const apiUrl = new URL(`${import.meta.env.BASE_URL}api/system-status`, window.location.origin);
        const response = await fetch(apiUrl, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          redirect: 'manual',
          signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403 || response.type === 'opaqueredirect') {
          setView({ state: 'error', accessDenied: true });
          return;
        }
        if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json')) {
          throw new Error('System status request failed.');
        }
        const payload: unknown = await response.json();
        if (!active) return;
        if (!isSystemStatus(payload)) throw new Error('System status response was invalid.');
        setView({ state: 'loaded', status: payload, stale: false });
      } catch {
        if (active) setView((current) => current.state === 'loaded' ? { ...current, stale: true } : { state: 'error' });
      } finally {
        inFlight = false;
        if (active) setRefreshing(false);
      }
    }

    refresh.current = load;
    void load();
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      refresh.current = null;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);

  const status = view.state === 'loaded' ? view.status : undefined;
  const loading = view.state === 'loading';

  return (
    <section className="system-status-card" aria-label={service.name}>
      <header className="system-status-header">
        <div>
          <span className="system-status-kicker">OWNER · SYSTEM METRICS</span>
          <h3>{service.name}</h3>
          {service.description && <p>{service.description}</p>}
        </div>
        <button className="system-status-refresh" type="button" onClick={() => refresh.current?.()} disabled={refreshing}>
          Refresh
        </button>
      </header>

      <div className="system-status-message">
        {view.state === 'error' ? (
          <span role="alert">{view.accessDenied
            ? 'System status access was denied. Check your sign-in and refresh.'
            : 'System status is unavailable. Refresh to try again.'}</span>
        ) : (
          <span role="status">
            {loading && 'Loading system status…'}
            {view.state === 'loaded' && (view.stale
              ? (refreshing ? 'Updating… Previous reading is stale.' : 'The latest update failed; showing the previous reading.')
              : (refreshing ? 'Updating… Showing the previous reading.' : ''))}
          </span>
        )}
      </div>
      <div className="system-status-meters">
        <MetricMeter label="CPU" loading={loading} percent={status?.cpu_percent} detail={status && `${status.logical_cores} logical cores`} />
        <MetricMeter label="Memory" loading={loading} percent={status?.memory_percent} detail={status && `${formatBytes(status.memory_used_bytes)} of ${formatBytes(status.memory_total_bytes)}`} />
        <MetricMeter label="Disk" loading={loading} percent={status?.disk_percent} detail={status && `${formatBytes(status.disk_free_bytes)} free of ${formatBytes(status.disk_total_bytes)}`} />
      </div>
      <div className="system-status-footer">
        <span><span>Load</span> {status ? status.load_1m.toFixed(2) : loading && <Skeleton />} · <span>Uptime</span> {status ? formatUptime(status.uptime_seconds) : loading && <Skeleton />}</span>
        <span><span>Updated</span> {status ? <span>{new Date(status.updated_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span> : loading && <Skeleton />}</span>
      </div>
      <a className="system-status-raw-link" href={service.url} target="_blank" rel="noreferrer">View raw JSON ↗</a>
    </section>
  );
}
