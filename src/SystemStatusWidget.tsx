import { useEffect, useState } from 'react';
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
  | { state: 'loaded'; status: SystemStatus }
  | { state: 'error' };

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

function MetricMeter({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  const rounded = Math.round(percent);
  return (
    <div className="status-meter">
      <div className="status-meter-heading"><span>{label}</span><strong>{rounded}%</strong></div>
      <progress max={100} value={Math.min(100, Math.max(0, percent))} aria-label={`${label} usage`} />
      <small>{detail}</small>
    </div>
  );
}

export function SystemStatusWidget({ service }: { service: ServiceItem }) {
  const [view, setView] = useState<StatusView>({ state: 'loading' });
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      setView({ state: 'loading' });
      try {
        const apiUrl = new URL(`${import.meta.env.BASE_URL}api/system-status`, window.location.origin);
        const response = await fetch(apiUrl, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!active) return;
        if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json')) {
          throw new Error('System status request failed.');
        }
        const payload: unknown = await response.json();
        if (!active) return;
        if (!isSystemStatus(payload)) throw new Error('System status response was invalid.');
        setView({ state: 'loaded', status: payload });
      } catch {
        if (active) setView({ state: 'error' });
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshIndex]);

  return (
    <section className="system-status-card" aria-label={service.name}>
      <header className="system-status-header">
        <div>
          <span className="system-status-kicker">OWNER · LIVE STATUS</span>
          <h3>{service.name}</h3>
          {service.description && <p>{service.description}</p>}
        </div>
        <button className="system-status-refresh" type="button" onClick={() => setRefreshIndex((value) => value + 1)} disabled={view.state === 'loading'}>
          {view.state === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {view.state === 'loading' && <p className="system-status-message" role="status">Loading system status…</p>}
      {view.state === 'error' && <p className="system-status-message" role="alert">System status is unavailable. Refresh to try again.</p>}
      {view.state === 'loaded' && <>
        <div className="system-status-meters">
          <MetricMeter label="CPU" percent={view.status.cpu_percent} detail={`${view.status.logical_cores} logical cores`} />
          <MetricMeter label="Memory" percent={view.status.memory_percent} detail={`${formatBytes(view.status.memory_used_bytes)} of ${formatBytes(view.status.memory_total_bytes)}`} />
          <MetricMeter label="Disk" percent={view.status.disk_percent} detail={`${formatBytes(view.status.disk_free_bytes)} free of ${formatBytes(view.status.disk_total_bytes)}`} />
        </div>
        <div className="system-status-footer">
          <span>Load {view.status.load_1m.toFixed(2)} · Uptime {formatUptime(view.status.uptime_seconds)}</span>
          <span>Updated {new Date(view.status.updated_at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
        </div>
      </>}
      <a className="system-status-raw-link" href={service.url} target="_blank" rel="noreferrer">View raw JSON ↗</a>
    </section>
  );
}
