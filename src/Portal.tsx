import type { PortalConfig } from './config';

export function Portal({ config }: { config: PortalConfig }) {
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
        <p>Your household services, together in one place.</p>
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
                <a className="service-card" href={service.url} key={service.id} target="_blank" rel="noreferrer">
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
