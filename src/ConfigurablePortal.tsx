import { useState } from 'react';
import { validateConfig } from './config';
import type { PortalConfig, ServiceItem } from './config';
import { Portal } from './Portal';

const STORAGE_KEY = 'home-services-portal-config';

function readConfig(fallback: PortalConfig): PortalConfig {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return fallback;
  }

  let stored: string | null;
  try {
    stored = storage.getItem(STORAGE_KEY);
  } catch {
    return fallback;
  }
  if (!stored) return fallback;

  try {
    return validateConfig(JSON.parse(stored));
  } catch {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be unavailable or read-only; the fallback is still usable.
    }
    return fallback;
  }
}

function createServiceId(services: ServiceItem[]): string {
  const existingIds = new Set(services.map((service) => service.id));
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      const id = crypto.randomUUID();
      if (!existingIds.has(id)) return id;
    }
  } catch {
    // randomUUID is unavailable on some browsers or non-secure origins.
  }

  let attempt = 0;
  let id: string;
  do {
    id = `service-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${attempt++}`;
  } while (existingIds.has(id));
  return id;
}

export function ConfigurablePortal({ initialConfig }: { initialConfig: PortalConfig }) {
  const [config, setConfig] = useState(() => readConfig(initialConfig));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  function save(next: PortalConfig): boolean {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      setError('Changes could not be saved in this browser. Check storage space or permissions.');
      return false;
    }
    setConfig(next);
    setError('');
    return true;
  }

  function addService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const item: ServiceItem = {
        id: createServiceId(config.services),
        name: String(data.get('name') ?? '').trim(),
        url: String(data.get('url') ?? '').trim(),
        description: String(data.get('description') ?? '').trim(),
        category: String(data.get('category') ?? '').trim(),
      };
      const next = validateConfig({ ...config, services: [...config.services, item] });
      if (save(next)) form.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add service.');
    }
  }

  function removeService(id: string) {
    save({ ...config, services: config.services.filter((service) => service.id !== id) });
  }

  function reset() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      setError('Could not reset because browser storage is unavailable.');
      return;
    }
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
