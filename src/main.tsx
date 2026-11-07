import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigurablePortal } from './ConfigurablePortal';
import { loadConfig } from './loadConfig';
import './style.css';

const root = createRoot(document.getElementById('root')!);
try {
  root.render(<ConfigurablePortal initialConfig={loadConfig()} />);
} catch (error) {
  root.render(<main className="shell"><section className="empty" role="alert"><h1>Could not load services</h1><p>{error instanceof Error ? error.message : 'Check public/services.json.'}</p></section></main>);
}
