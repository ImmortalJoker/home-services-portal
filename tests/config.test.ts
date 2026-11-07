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

  it('rejects relative URLs', () => {
    expect(() => validateConfig({ portalName: 'Home', services: [{ id: 'x', name: 'X', url: '/local' }] })).toThrow('absolute');
  });

  it('rejects non-web protocols', () => {
    expect(() => validateConfig({ portalName: 'Home', services: [{ id: 'x', name: 'X', url: 'javascript:alert(1)' }] })).toThrow('HTTP or HTTPS');
  });
});
