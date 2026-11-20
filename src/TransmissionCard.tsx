import { useEffect, useState } from 'react';
import type { ServiceItem } from './config';
import { ServiceIcon } from './ServiceIcon';

interface Summary { active: number; total: number; percent: number | null; download_bps: number; upload_bps: number }
function speed(bytes: number) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB/s` : `${Math.round(bytes / 1024)} KB/s`; }
export function TransmissionCard({ service }: { service: ServiceItem }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}api/transmission-status`, { cache: 'no-store', signal: controller.signal });
        if (!r.ok) throw new Error('Unavailable');
        const d = await r.json();
        if (!['active', 'total', 'download_bps', 'upload_bps'].every(k => Number.isFinite(d[k]) && d[k] >= 0) ||
            !(d.percent === null || Number.isFinite(d.percent) && d.percent >= 0 && d.percent <= 100) || d.active > d.total) throw new Error('Invalid summary');
        if (active) { setSummary(d); setFailed(false); }
      } catch { if (active) { setSummary(null); setFailed(true); } }
    };
    void load();
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; controller.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return <article className={`service-tile transmission-tile${open ? ' transmission-expanded' : ''}`} aria-label="Transmission">
    <div className="transmission-card-top"><a className="service-card" href={service.url} target="_blank" rel="noreferrer" aria-label="Open Transmission">
      <span className="card-mark mark-2"><ServiceIcon id="transmission" name={service.name} /></span><span className="card-copy"><strong>{service.name}</strong></span>
    </a>
    <div className="transmission-stats" aria-live="polite">{summary ? <>
      <span>{summary.active} running / {summary.total} total</span>
      <strong>{summary.percent === null ? 'No torrents' : `${Math.round(summary.percent)}% overall`}</strong>
      <span className="transmission-speeds">↓ {speed(summary.download_bps)} · ↑ {speed(summary.upload_bps)}</span>
    </> : <span>{failed ? 'Status unavailable' : 'Loading status…'}</span>}</div>
    <button type="button" className="transmission-expand" aria-expanded={open} aria-controls="transmission-panel" onClick={() => setOpen(!open)}>
      <span>Web controls</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg>
    </button></div>
    {open && <div className="transmission-panel" id="transmission-panel">
      <div className="transmission-panel-heading"><p>Full Transmission controls. If sign-in is needed, <a href={service.url} target="_blank" rel="noreferrer">open in a full page</a>, then reload this panel.</p><button type="button" onClick={() => setFrameKey(k => k + 1)}>Reload panel</button></div>
      <iframe key={frameKey} src={service.url} title="Transmission web controls" loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" />
    </div>}
  </article>;
}
