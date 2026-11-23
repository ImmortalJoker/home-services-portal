import type { PortalConfig } from './config';
import { useRef, useState, type KeyboardEvent } from 'react';
import { SystemStatusWidget } from './SystemStatusWidget';
import { detectMobilePlatform, getAppLaunch } from '../deploy/authentik/portal/launch.mjs';
import './service-launch.css';
import { ThemeControl } from './ThemeControl';
import { InstallPortal } from './InstallPortal';
import { ServiceIcon } from './ServiceIcon';
import { AppRecommendations } from './AppRecommendations';
import { TransmissionCard } from './TransmissionCard';

export interface PortalIdentity {
  username: string;
  name: string;
  email: string;
  role: 'Pending' | 'Public' | 'Family' | 'Owner';
}

type Connection = 'local' | 'tailscale' | 'unknown';
function PortalHeader({ config, identity, connection, pending = false }: { config: PortalConfig; identity?: PortalIdentity; connection: Connection; pending?: boolean }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountToggle = useRef<HTMLButtonElement>(null);

  function closeAccountOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !accountOpen) return;
    setAccountOpen(false);
    accountToggle.current?.focus();
  }

  const routeLabel = connection === 'local' ? 'Local network' : connection === 'tailscale' ? 'Tailscale' : 'Connection unknown';
  return <header className="portal-header">
    <div className="portal-heading"><div className="portal-title-line">
      <span className={`connection-indicator connection-${connection}`} role="status" aria-label={routeLabel} title={routeLabel}><span aria-hidden="true" /></span>
      <h1 title={config.portalName}>{config.portalName}</h1><span className="connection-label">{routeLabel}</span>
    </div><p>{pending ? 'Your account is signed in; service access is still being reviewed.' : 'Your household services, together.'}</p></div>
    <div className="portal-header-actions">
      <ThemeControl />
      {identity && <div className="identity-badge" aria-label="Signed-in account" onKeyDown={closeAccountOnEscape}>
        <button ref={accountToggle} className="identity-menu-toggle" type="button" aria-label="Account menu" aria-expanded={accountOpen} aria-controls="portal-account-menu" onClick={() => setAccountOpen(!accountOpen)}>
          <span aria-hidden="true">{identity.name.trim().charAt(0).toUpperCase() || identity.username.charAt(0).toUpperCase()}</span>
        </button>
        <span className="identity-avatar" aria-hidden="true">{identity.name.trim().charAt(0).toUpperCase() || identity.username.charAt(0).toUpperCase()}</span>
        <span className="identity-copy"><strong>{identity.name || identity.username}</strong><small>{pending ? 'Access pending' : `${identity.role} access`}</small></span>
        <a className="identity-signout" href="/outpost.goauthentik.io/sign_out">Sign out</a>
        <div className="identity-mobile-menu" id="portal-account-menu" hidden={!accountOpen}>
          {accountOpen && <>
            <strong>{identity.name || identity.username}</strong>
            <small>{pending ? 'Access pending' : `${identity.role} access`}</small>
            <a href="/outpost.goauthentik.io/sign_out">Sign out</a>
          </>}
        </div>
      </div>}
      {!pending && <InstallPortal />}
    </div>
  </header>;
}

export function Portal({ config, identity, connection = 'unknown' }: { config: PortalConfig; identity?: PortalIdentity; connection?: Connection }) {
  const platform = detectMobilePlatform(typeof navigator === 'undefined' ? undefined : navigator);
  if (identity?.role === 'Pending') {
    return (
      <main className="shell">
        <PortalHeader config={config} identity={identity} connection={connection} pending />
        <section className="atrium" aria-labelledby="atrium-title">
          <span className="atrium-mark" aria-hidden="true">⌛</span>
          <div>
            <span className="atrium-kicker">ATRIUM · PENDING REVIEW</span>
            <h2 id="atrium-title">Your access is pending</h2>
            <p>The owner must approve your access before household services become available.</p>
            <p>After approval, refresh this page to see the services assigned to you.</p>
          </div>
        </section>
        <footer><span>PRIVATE HOUSEHOLD PORTAL</span><span>Home Services Portal <b>↗</b></span></footer>
      </main>
    );
  }

  return (
    <main className="shell">
      <PortalHeader config={config} identity={identity} connection={connection} />
      {config.services.filter(service => service.widget === 'system-status').map(service => <SystemStatusWidget key={service.id} service={service} />)}
      {config.services.length === 0 ? (
        <section className="empty" aria-label="No services configured">
          <span className="empty-icon" aria-hidden="true">＋</span>
          <h2>No services yet</h2>
          <p>Add your services to <code>public/services.json</code> to get started.</p>
        </section>
      ) : (
          <section className="service-group" aria-label="Services">
            <div className="service-grid portal-tiles">
              {config.services.filter(service => service.widget !== 'system-status').map(service => {
                if (service.id === 'transmission') return <TransmissionCard key={service.id} service={service} />;
                const app = getAppLaunch(service, platform);
                const webLink = <a className="service-card" href={service.url} target="_blank" rel="noreferrer" aria-label={`Open ${service.name}`} title={service.description}>
                    <span className="card-mark"><ServiceIcon id={service.id} name={service.name} /></span>
                    <span className="card-copy">
                      <strong>{service.name}</strong>
                    </span>
                  </a>;
                return <article className="service-tile" key={service.id} aria-label={service.name}>
                  {webLink}
                  {(app || service.opdsUrl) && <div className="service-launch-actions">
                    {app && <><a className="service-launch-app" href={app.href} aria-label={`Open ${service.name} in ${app.label}`} referrerPolicy="no-referrer">App</a>
                    <a className="service-launch-web" href={service.url} target="_blank" rel="noreferrer" aria-label={`Open ${service.name} in browser`}>Open web</a>
                    </>}
                    {service.opdsUrl && <a className="service-launch-web" href={service.opdsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${service.name} OPDS`}>OPDS</a>}
                  </div>}
                </article>;
              })}
            </div>
          </section>
      )}
      <AppRecommendations services={config.services} />
      <footer><span>SELF-HOSTED · CONFIGURABLE · YOURS</span><span>Home Services Portal <b>↗</b></span></footer>
    </main>
  );
}
