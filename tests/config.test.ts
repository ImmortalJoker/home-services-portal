import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/config';

const valid = { portalName: 'Home', services: [{ id: 'books', name: 'Books', url: 'http://books.local:8080' }] };

describe('validateConfig', () => {
  it('accepts a valid portal configuration', () => {
    expect(validateConfig(valid)).toEqual({
      portalName: 'Home',
      services: [{ id: 'books', name: 'Books', description: undefined, url: 'http://books.local:8080/', category: undefined }],
    });
  });

  it('allows an empty service list', () => {
    expect(validateConfig({ portalName: 'Home', services: [] }).services).toEqual([]);
  });

  it('rejects missing portal names', () => {
    expect(() => validateConfig({ services: [] })).toThrow('portalName');
  });

  it('rejects duplicate service ids', () => {
    expect(() => validateConfig({ portalName: 'Home', services: [valid.services[0], valid.services[0]] })).toThrow('Duplicate service id');
  });

  it('accepts safe same-origin paths for links served by the portal', () => {
    expect(validateConfig({ portalName: 'Home', services: [{ id: 'x', name: 'X', url: '/owner-check' }] }).services[0].url).toBe('/owner-check');
  });

  it('rejects protocol-relative links that escape the portal origin', () => {
    expect(() => validateConfig({ portalName: 'Home', services: [{ id: 'x', name: 'X', url: '//evil.example/path' }] })).toThrow('absolute');
  });

  it('accepts group visibility metadata without changing generic IDs', () => {
    expect(validateConfig({ portalName: 'Home', services: [{ id: 'x', name: 'X', url: '/family-check', accessGroups: ['Portal - Family'] }] }).services[0].accessGroups).toEqual(['Portal - Family']);
  });

  it('preserves the configured system-status widget type', () => {
    expect(validateConfig({ portalName: 'Home', services: [{ id: 'status', name: 'System status', url: '/api/status', accessGroups: ['Portal - Owner'], widget: 'system-status' }] }).services[0].widget).toBe('system-status');
  });

  it('normalizes duplicate Owner groups for a system-status widget', () => {
    const config = validateConfig({ portalName: 'Home', services: [{ ...valid.services[0], widget: 'system-status', accessGroups: [' Portal - Owner ', 'Portal - Owner'] }] });
    expect(config.services[0].accessGroups).toEqual(['Portal - Owner']);
    expect(config.services[0].widget).toBe('system-status');
  });

  it('rejects unsupported widget types', () => {
    expect(() => validateConfig({ portalName: 'Home', services: [{ id: 'x', name: 'X', url: '/x', widget: 'unknown-widget' }] })).toThrow('widget');
  });

  it('rejects malformed group visibility metadata', () => {
    expect(() => validateConfig({ portalName: 'Home', services: [{ id: 'x', name: 'X', url: '/family-check', accessGroups: [''] }] })).toThrow('accessGroups');
  });

  it('rejects non-web protocols', () => {
    expect(() => validateConfig({ portalName: 'Home', services: [{ id: 'x', name: 'X', url: 'javascript:alert(1)' }] })).toThrow('HTTP or HTTPS');
  });

  it.each([
    'https://user:password@service.example.test/',
    'http://user@service.example.test/',
    'https://:password@service.example.test/',
    'https://%75ser:p%40ss@service.example.test/',
  ])('rejects embedded userinfo in service URL %s', (url) => {
    expect(() => validateConfig({ ...valid, services: [{ ...valid.services[0], url }] })).toThrow('credentials');
  });

  it.each([
    undefined,
    ['Portal - Public'],
    ['Portal - Family'],
    ['Portal - Public', 'Portal - Owner'],
    ['Portal - Owner', 'Portal - Public'],
    ['Portal - Family', 'Portal - Owner'],
    [' Portal - Public ', ' Portal - Owner '],
  ].map((accessGroups) => ({ accessGroups })))('rejects system-status visibility outside Owner: %j', ({ accessGroups }) => {
    expect(() => validateConfig({ ...valid, services: [{ ...valid.services[0], widget: 'system-status', accessGroups }] })).toThrow('restricted to Portal - Owner');
  });
});

describe('public sample services.json', () => {
  const sample = JSON.parse(readFileSync(resolve(process.cwd(), 'public/services.json'), 'utf8'));

  it('remains a valid config with the expected sample service IDs', () => {
    expect(validateConfig(sample).services.map((service) => service.id)).toEqual(['media-library', 'books', 'knowledge']);
  });

  it('uses only reserved example.test hosts for every URL value', () => {
    const urlValues: string[] = [];
    const collect = (value: unknown) => {
      if (typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) urlValues.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(sample);

    expect(urlValues.length).toBeGreaterThanOrEqual(sample.services.length);
    for (const value of urlValues) {
      const { hostname } = new URL(value);
      expect(hostname === 'example.test' || hostname.endsWith('.example.test')).toBe(true);
    }
  });
});
