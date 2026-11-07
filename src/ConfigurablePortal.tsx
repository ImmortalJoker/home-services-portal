import { useState } from 'react';
import { validateConfig } from './config';
import type { PortalConfig, ServiceItem } from './config';
import { Portal } from './Portal';

const STORAGE_KEY = 'home-services-portal-config';

function readConfig(fallback: PortalConfig): PortalConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? validateConfig(JSON.parse(stored)) : fallback;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return fallback;
  }
}

export function ConfigurablePortal({ initialConfig }: { initialConfig: PortalConfig }) {
  const [config, setConfig] = useState(() => readConfig(initialConfig));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  function save(next: PortalConfig) {
    setConfig(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setError('');
  }

  function addService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const item: ServiceItem = {
      id: crypto.randomUUID(),
      name: String(data.get('name') ?? '').trim(),
      url: String(data.get('url') ?? '').trim(),
      description: String(data.get('description') ?? '').trim(),
      category: String(data.get('category') ?? '').trim(),
    };
    try {
      save(validateConfig({ ...config, services: [...config.services, item] }));
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add service.');
    }
  }

  function removeService(id: string) {
    save({ ...config, services: config.services.filter((service) => service.id !== id) });
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    setConfig(initialConfig);
    setError('');
  }

  function exportConfig() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'services.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="customize-bar"><button type="button" onClick={() => setEditing(!editing)}>{editing ? 'Close customization' : 'Customize services'}</button></div>
      {editing && <section className="editor" aria-label="Customize services">
        <div className="editor-heading"><div><h2>Customize this portal</h2><p>Changes are saved only in this browser.</p></div><div className="editor-actions"><button type="button" onClick={exportConfig}>Export config</button><button type="button" onClick={reset}>Reset to example</button></div></div>
        {error && <p role="alert" className="form-error">{error}</p>}
        <ul className="service-list">{config.services.map((service) => <li key={service.id}><span><strong>{service.name}</strong><small>{service.url}</small></span><button type="button" aria-label={`Remove ${service.name}`} onClick={() => removeService(service.id)}>Remove</button></li>)}</ul>
        <form onSubmit={addService} className="service-form">
          <label>Service name<input name="name" required /></label>
          <label>Service URL<input name="url" type="url" placeholder="https://service.example" required /></label>
          <label>Description <span className="optional">optional</span><input name="description" /></label>
          <label>Category <span className="optional">optional</span><input name="category" /></label>
          <button type="submit">Add service</button>
        </form>
      </section>}
      <Portal config={config} />
    </>
  );
}
