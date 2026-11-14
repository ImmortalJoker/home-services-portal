import type { PortalConfig } from './config';
import { SystemStatusWidget } from './SystemStatusWidget';

export interface PortalIdentity {
  username: string;
  name: string;
  email: string;
  role: 'Pending' | 'Public' | 'Family' | 'Owner';
}

export function Portal({ config, identity }: { config: PortalConfig; identity?: PortalIdentity }) {
  if (identity?.role === 'Pending') {
    return (
      <main className="shell">
        <header className="hero">
          <div className="eyebrow"><span className="pulse" /> HOME NETWORK</div>
          <h1>{config.portalName}</h1>
          <p>Your account is signed in; service access is still being reviewed.</p>
          <div className="identity-badge" aria-label="Signed-in account">
            <span className="identity-avatar" aria-hidden="true">{identity.name.trim().charAt(0).toUpperCase() || identity.username.charAt(0).toUpperCase()}</span>
            <span className="identity-copy"><strong>{identity.name || identity.username}</strong><small>Access pending</small></span>
            <a className="identity-signout" href="/outpost.goauthentik.io/sign_out">Sign out</a>
          </div>
        </header>
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

  const groups = new Map<string, PortalConfig['services']>();
  for (const service of config.services) {
    const category = service.category?.trim() || 'Other services';
    groups.set(category, [...(groups.get(category) ?? []), service]);
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow"><span className="pulse" /> HOME NETWORK</div>
        <h1>{config.portalName}</h1>
        <p>{identity ? 'Your services, personalized by your portal access.' : 'Your household services, together in one place.'}</p>
        {identity && <div className="identity-badge" aria-label="Signed-in account">
          <span className="identity-avatar" aria-hidden="true">{identity.name.trim().charAt(0).toUpperCase() || identity.username.charAt(0).toUpperCase()}</span>
          <span className="identity-copy"><strong>{identity.name || identity.username}</strong><small>{identity.role} access</small></span>
          <a className="identity-signout" href="/outpost.goauthentik.io/sign_out">Sign out</a>
        </div>}
      </header>
      {config.services.length === 0 ? (
        <section className="empty" aria-label="No services configured">
          <span className="empty-icon" aria-hidden="true">＋</span>
          <h2>No services yet</h2>
          <p>Add your services to <code>public/services.json</code> to get started.</p>
        </section>
      ) : (
        [...groups].map(([category, services]) => (
          <section className="service-group" key={category} aria-label={category}>
            <div className="group-heading">
              <h2>{category}</h2><span className="count">{String(services.length).padStart(2, '0')}</span>
            </div>
            <div className="service-grid">
              {services.map((service, index) => (
                service.widget === 'system-status'
                  ? <SystemStatusWidget key={service.id} service={service} />
                  : <a className="service-card" href={service.url} key={service.id} target="_blank" rel="noreferrer">
                    <span className={`card-mark mark-${index % 4}`} aria-hidden="true">{service.name.trim().charAt(0).toUpperCase()}</span>
                    <span className="card-copy">
                      <strong>{service.name}</strong>
                      <span>{service.description || 'Open service'}</span>
                    </span>
                    <span className="arrow" aria-hidden="true">↗</span>
                  </a>
              ))}
            </div>
          </section>
        ))
      )}
      <footer><span>SELF-HOSTED · CONFIGURABLE · YOURS</span><span>Home Services Portal <b>↗</b></span></footer>
    </main>
  );
}
