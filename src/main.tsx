import React from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from './PortalApp';
import { applyTheme, getSystemTheme, readThemePreference } from './theme';
import './fonts.css';
import './theme.css';
import './style.css';

// The worker provides a generic offline message; private pages/API data are never cached.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    }).catch(() => { /* Browser-menu installation remains available. */ });
  });
}

const preference = readThemePreference();
applyTheme(preference, preference === 'system' ? getSystemTheme() : undefined);

const root = createRoot(document.getElementById('root')!);
root.render(<PortalApp />);
