import { useState } from 'react';
import type { ServiceItem } from './config';
import type { ServiceGuide } from '../deploy/authentik/portal/guides.mjs';
import { detectMobilePlatform } from '../deploy/authentik/portal/launch.mjs';

function ConnectionAddress({ guide, service }: { guide: ServiceGuide; service: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!guide.connectionUrl) return null;
  async function copy() {
    try { await navigator.clipboard.writeText(guide.connectionUrl!); setCopied(true); setFailed(false); }
    catch { setFailed(true); }
  }
  return <div className="guide-connection"><label>{guide.connectionLabel || 'Server address'}
    <input aria-label={`${service} ${guide.connectionLabel || 'server address'}`} readOnly value={guide.connectionUrl} onFocus={event => event.currentTarget.select()} />
  </label><button type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy address'}</button>
    {failed && <small role="status">Select the address above and copy it.</small>}
  </div>;
}

export function AppRecommendations({ services }: { services: ServiceItem[] }) {
  const [platform, setPlatform] = useState<'ios' | 'android'>(() => detectMobilePlatform(navigator) ?? 'ios');
  const available = services.filter(service => service.guides?.ios || service.guides?.android);
  if (!available.length) return null;
  return <section className="app-recommendations" aria-labelledby="app-recommendations-title">
    <div className="recommendations-heading"><div><h2 id="app-recommendations-title">Apps & connection guides</h2><p>Optional apps and setup steps for the services available to you.</p></div>
      <div className="platform-switch" role="group" aria-label="App recommendation platform">
        <button type="button" aria-pressed={platform === 'ios'} onClick={() => setPlatform('ios')}>iPhone & iPad</button>
        <button type="button" aria-pressed={platform === 'android'} onClick={() => setPlatform('android')}>Android</button>
      </div>
    </div>
    <p className="recommendations-note">At home, use your home Wi-Fi. Away from home, connect to Tailscale first. Installing an app doesn’t change your access.</p>
    <ul className="recommended-apps">{available.map(service => {
      const guide = service.guides?.[platform];
      if (!guide) return null;
      return <li key={service.id} aria-label={`${service.name} setup`}>
        <span className="recommendation-purpose">{service.name}</span>
        {guide.downloadUrl ? <a href={guide.downloadUrl} target="_blank" rel="noreferrer">{guide.title}</a> : <h3>{guide.title}</h3>}
        <ol>{guide.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        <ConnectionAddress key={`${service.id}-${platform}`} service={service.name} guide={guide} />
      </li>;
    })}</ul>
  </section>;
}
