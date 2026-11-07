import React from 'react';
import { createRoot } from 'react-dom/client';
import { Portal } from './Portal';
import { loadConfig } from './loadConfig';
import './style.css';

const root = createRoot(document.getElementById('root')!);
try {
  root.render(<Portal config={loadConfig()} />);
} catch (error) {
  root.render(<main className="shell"><section className="empty" role="alert"><h1>Could not load services</h1><p>{error instanceof Error ? error.message : 'Check public/services.json.'}</p></section></main>);
}
