import { useEffect, useState } from 'react';
import { Portal } from './Portal';
import type { PortalConfig } from './config';
import { validateConfig } from './config';
import './authenticated-portal.css';

interface PortalIdentity {
  username: string;
  name: string;
  email: string;
  role: 'Pending' | 'Public' | 'Family' | 'Owner';
}

type PortalView =
  | { state: 'loading' }
  | { state: 'authenticated'; config: PortalConfig; identity: PortalIdentity; connection: 'local' | 'tailscale' | 'unknown' }
  | { state: 'denied' }
  | { state: 'error' };

function isIdentity(value: unknown): value is PortalIdentity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.username === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.email === 'string' &&
    ['Pending', 'Public', 'Family', 'Owner'].includes(String(candidate.role));
}

function isPortalPayload(value: unknown): value is { portalName: string; identity: PortalIdentity; services: unknown[] } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.portalName === 'string' &&
    isIdentity(candidate.identity) &&
    Array.isArray(candidate.services);
}

export function AuthenticatedPortal() {
  const [view, setView] = useState<PortalView>({ state: 'loading' });

  useEffect(() => {
    let active = true;
    const apiUrl = new URL(`${import.meta.env.BASE_URL}api/session`, window.location.origin);

    async function load() {
      try {
        const response = await fetch(apiUrl, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!active) return;

        if (response.status === 401 || response.status === 403) {
          setView({ state: 'denied' });
          return;
        }
        if (!response.ok) throw new Error('Portal API request failed.');

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          throw new Error('Portal API returned a non-JSON response.');
        }

        const payload: unknown = await response.json();
        if (!active) return;
        if (!isPortalPayload(payload)) throw new Error('Portal API returned an invalid response.');
        const config = validateConfig({ portalName: payload.portalName, services: payload.services });
        const route = response.headers.get('X-Portal-Connection');
        setView({ state: 'authenticated', config, identity: payload.identity, connection: route === 'local' || route === 'tailscale' ? route : 'unknown' });
      } catch {
        if (active) setView({ state: 'error' });
      }
    }

    void load();
    return () => { active = false; };
  }, []);

  if (view.state === 'loading') {
    return <main className="shell auth-state" role="status">Loading your portal…</main>;
  }
  if (view.state === 'denied') {
    return <main className="shell auth-state" role="alert">
      <h1>Portal access unavailable</h1>
      <p>This account is not assigned to an access group for this portal. Ask the owner to grant access.</p>
    </main>;
  }
  if (view.state === 'error') {
    return <main className="shell auth-state" role="alert">
      <h1>Could not load your portal</h1>
      <p>Refresh the page. If the problem continues, ask the owner to check the portal service.</p>
    </main>;
  }
  return <Portal config={view.config} identity={view.identity} connection={view.connection} />;
}
