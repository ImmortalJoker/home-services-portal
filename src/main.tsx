import React from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from './PortalApp';
import './style.css';

const root = createRoot(document.getElementById('root')!);
root.render(<PortalApp />);
