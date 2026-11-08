import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurablePortal } from '../src/ConfigurablePortal';
import type { PortalConfig } from '../src/config';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const initial: PortalConfig = { portalName: 'Demo', services: [] };

describe('ConfigurablePortal', () => {
  it('adds a service and persists the change locally', () => {
    render(<ConfigurablePortal initialConfig={initial} />);
    fireEvent.click(screen.getByRole('button', { name: /customize/i }));
    fireEvent.change(screen.getByLabelText('Service name'), { target: { value: 'Books' } });
    fireEvent.change(screen.getByLabelText('Service URL'), { target: { value: 'http://books.local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    expect(screen.getByRole('link', { name: /Books/ })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('home-services-portal-config')!).services[0].name).toBe('Books');
  });

  it('does not add invalid URLs and displays a validation error', () => {
    render(<ConfigurablePortal initialConfig={initial} />);
    fireEvent.click(screen.getByRole('button', { name: /customize/i }));
    fireEvent.change(screen.getByLabelText('Service name'), { target: { value: 'Bad' } });
    fireEvent.change(screen.getByLabelText('Service URL'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    expect(screen.getByRole('alert').textContent).toMatch(/HTTP or HTTPS/);
    expect(screen.queryByRole('link', { name: /Bad/ })).toBeNull();
  });

  it('clears browser customization and restores the supplied starter config', () => {
    localStorage.setItem('home-services-portal-config', JSON.stringify({ portalName: 'Custom', services: [] }));
    render(<ConfigurablePortal initialConfig={initial} />);
    expect(screen.getByRole('heading', { name: 'Custom' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /customize/i }));
    fireEvent.click(screen.getByRole('button', { name: /reset to example/i }));
    expect(screen.getByRole('heading', { name: 'Demo' })).toBeTruthy();
    expect(localStorage.getItem('home-services-portal-config')).toBeNull();
  });

  it('renders the starter config when browser storage access is denied', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('Storage access denied'); } });
    try {
      render(<ConfigurablePortal initialConfig={initial} />);
      expect(screen.getByRole('heading', { name: 'Demo' })).toBeTruthy();
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });

  it('does not display an added service when storage persistence fails', () => {
    render(<ConfigurablePortal initialConfig={initial} />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    fireEvent.click(screen.getByRole('button', { name: /customize/i }));
    fireEvent.change(screen.getByLabelText('Service name'), { target: { value: 'Books' } });
    fireEvent.change(screen.getByLabelText('Service URL'), { target: { value: 'http://books.local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    expect(screen.queryByRole('link', { name: /Books/ })).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/could not be saved/i);
  });

  it('keeps a service visible and reports an error when removal cannot be saved', () => {
    const stored = { portalName: 'Demo', services: [{ id: 'books', name: 'Books', url: 'http://books.local' }] };
    localStorage.setItem('home-services-portal-config', JSON.stringify(stored));
    render(<ConfigurablePortal initialConfig={initial} />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    fireEvent.click(screen.getByRole('button', { name: /customize/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Books' }));
    expect(screen.getByRole('link', { name: /Books/ })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/could not be saved/i);
  });

  it('keeps the current config when clearing browser storage fails', () => {
    localStorage.setItem('home-services-portal-config', JSON.stringify({ portalName: 'Custom', services: [] }));
    render(<ConfigurablePortal initialConfig={initial} />);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage denied'); });
    fireEvent.click(screen.getByRole('button', { name: /customize/i }));
    fireEvent.click(screen.getByRole('button', { name: /reset to example/i }));
    expect(screen.getByRole('heading', { name: 'Custom' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/could not reset/i);
  });

  it('adds a service when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {});
    try {
      render(<ConfigurablePortal initialConfig={initial} />);
      fireEvent.click(screen.getByRole('button', { name: /customize/i }));
      fireEvent.change(screen.getByLabelText('Service name'), { target: { value: 'Books' } });
      fireEvent.change(screen.getByLabelText('Service URL'), { target: { value: 'http://books.local' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
      expect(screen.getByRole('link', { name: /Books/ })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(JSON.parse(localStorage.getItem('home-services-portal-config')!).services[0].id).toMatch(/^service-/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
