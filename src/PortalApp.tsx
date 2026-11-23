import { ThemeProvider } from './ThemeControl';
import { AuthenticatedPortal } from './AuthenticatedPortal';
import { ConfigurablePortal } from './ConfigurablePortal';
import { loadConfig } from './loadConfig';

export function PortalApp() {
  return <ThemeProvider>{import.meta.env.VITE_PORTAL_PUBLIC_DEMO === 'true'
    ? <ConfigurablePortal initialConfig={loadConfig()} />
    : <AuthenticatedPortal />}</ThemeProvider>;
}
