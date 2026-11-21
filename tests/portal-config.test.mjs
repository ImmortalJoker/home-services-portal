import assert from 'node:assert/strict';
import { it } from 'node:test';
import { filterServices, validatePortalConfig } from '../deploy/authentik/portal/server.mjs';

const service = { id: 'status', name: 'Status', url: 'https://service.example.test/' };
const configWith = (overrides) => ({ portalName: 'Test', services: [{ ...service, ...overrides }] });

for (const url of [
  'https://user:password@service.example.test/',
  'http://user@service.example.test/',
  'https://:password@service.example.test/',
  'https://%75ser:p%40ss@service.example.test/',
]) {
  it(`rejects embedded userinfo in service URL ${url}`, () => {
    assert.throws(() => validatePortalConfig(configWith({ url })), /credentials/);
  });
}

it('preserves credential-free HTTP(S) URLs and same-origin paths', () => {
  for (const url of ['http://service.example.test/', 'https://service.example.test:8443/path?q=value#part', '/status?q=value#part']) {
    assert.equal(validatePortalConfig(configWith({ url })).services[0].url, url);
  }
});

for (const accessGroups of [
  undefined,
  ['Portal - Public'],
  ['Portal - Family'],
  ['Portal - Public', 'Portal - Owner'],
  ['Portal - Owner', 'Portal - Public'],
  ['Portal - Family', 'Portal - Owner'],
  [' Portal - Public ', ' Portal - Owner '],
]) {
  it(`rejects system-status visibility outside Owner: ${JSON.stringify(accessGroups)}`, () => {
    assert.throws(() => validatePortalConfig(configWith({ widget: 'system-status', accessGroups })), /restricted to Portal - Owner/);
  });
}

it('normalizes Owner-only status metadata and keeps it invisible to non-Owners', () => {
  const { services } = validatePortalConfig(configWith({
    widget: 'system-status', accessGroups: [' Portal - Owner ', 'Portal - Owner'],
  }));
  assert.deepEqual(services[0].accessGroups, ['Portal - Owner']);
  for (const group of ['Portal - Public', 'Portal - Family', 'Portal - Pending']) {
    assert.deepEqual(filterServices(services, [group]), []);
  }
  assert.equal(filterServices(services, ['Portal - Owner'])[0].widget, 'system-status');
});

it('still permits ordinary service metadata shared by Public and Owner', () => {
  const { services } = validatePortalConfig(configWith({ accessGroups: ['Portal - Public', 'Portal - Owner'] }));
  assert.equal(filterServices(services, ['Portal - Public']).length, 1);
});
