import React from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from './PortalApp';
import './fonts.css';
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

const root = createRoot(document.getElementById('root')!);
root.render(<PortalApp />);
