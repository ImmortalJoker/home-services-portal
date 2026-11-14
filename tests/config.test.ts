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

  it('rejects unsupported widget types', () => {
    expect(() => validateConfig({ portalName: 'Home', services: [{ id: 'x', name: 'X', url: '/x', widget: 'unknown-widget' }] })).toThrow('widget');
  });

  it('rejects malformed group visibility metadata', () => {
    expect(() => validateConfig({ portalName: 'Home', services: [{ id: 'x', name: 'X', url: '/family-check', accessGroups: [''] }] })).toThrow('accessGroups');
  });

  it('rejects non-web protocols', () => {
    expect(() => validateConfig({ portalName: 'Home', services: [{ id: 'x', name: 'X', url: 'javascript:alert(1)' }] })).toThrow('HTTP or HTTPS');
  });
});
