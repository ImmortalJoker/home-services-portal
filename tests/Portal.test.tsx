import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Portal } from '../src/Portal';
import type { PortalConfig } from '../src/config';

afterEach(cleanup);

const config: PortalConfig = {
  portalName: 'My Services',
  services: [
    { id: 'books', name: 'Books', description: 'Read books', url: 'http://books.local', category: 'Reading' },
    { id: 'media', name: 'Media', url: 'http://media.local', category: 'Entertainment' },
  ],
};

describe('Portal', () => {
  it('renders the configured title and groups', () => {
    render(<Portal config={config} />);
    expect(screen.getByRole('heading', { name: 'My Services' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Reading' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Entertainment' })).toBeTruthy();
  });

  it('renders service links with safe external-link attributes', () => {
    render(<Portal config={config} />);
    const link = screen.getByRole('link', { name: /BooksRead books/ });
    expect(link.getAttribute('href')).toBe('http://books.local');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('renders an empty state when no services are configured', () => {
    render(<Portal config={{ portalName: 'Empty', services: [] }} />);
    expect(screen.getByRole('region', { name: 'No services configured' })).toBeTruthy();
    expect(screen.getByText(/public\/services.json/)).toBeTruthy();
  });

  it('renders service names as text, not injected markup', () => {
    render(<Portal config={{ portalName: 'Test', services: [{ id: 'x', name: '<img src=x onerror=alert(1)>', url: 'http://example.local' }] }} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });
});
