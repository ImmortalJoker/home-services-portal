import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(resolve(process.cwd(), 'deploy/authentik/compose.yml'), 'utf8');
const blueprint = readFileSync(resolve(process.cwd(), 'deploy/authentik/blueprints/portal-access-groups.yaml'), 'utf8');
const demoPage = readFileSync(resolve(process.cwd(), 'deploy/authentik/portal-test/index.html'), 'utf8');

describe('protected Authentik demo service', () => {
  it('runs an unprivileged read-only upstream without publishing a host port', () => {
    const service = compose.split('  portal-test:\n')[1]?.split('\n  server:\n')[0] ?? '';
    expect(service).toContain('python:3.13-alpine');
    expect(service).toContain('user: "65534:65534"');
    expect(service).toContain('read_only: true');
    expect(service).toContain('./portal-test:/srv:ro');
    expect(service).not.toMatch(/^\s*ports:/m);
  });

  it('creates the proxy only when an external test URL is configured', () => {
    expect(blueprint).toContain('model: authentik_providers_proxy.proxyprovider');
    expect(blueprint).toContain('conditions:\n      - !Env PORTAL_TEST_EXTERNAL_HOST');
    expect(blueprint).toContain('internal_host: http://portal-test:8080');
    expect(blueprint).toContain('external_host: !Env PORTAL_TEST_EXTERNAL_HOST');
    expect(blueprint).toContain('mode: proxy');
  });

  it('binds the demo application to the owner group by default', () => {
    expect(blueprint).toContain('model: authentik_core.application');
    const binding = blueprint.split('model: authentik_policies.policybinding')[1] ?? '';
    expect(binding).toContain('target: !KeyOf portal-test-application');
    expect(binding).toContain('attrs:\n      group: !Find [authentik_core.group, [name, Portal - Owner]]');
    const identifiers = binding.split('    attrs:')[0] ?? '';
    expect(identifiers).not.toContain('group:');
    expect(blueprint).toContain('policy_engine_mode: any');
  });

  it('assigns the proxy provider to the embedded outpost', () => {
    const outpost = blueprint.split('model: authentik_outposts.outpost')[1] ?? '';
    expect(outpost).toContain('identifiers:\n      name: authentik Embedded Outpost');
    expect(outpost).toContain('providers:\n        - !KeyOf portal-test-provider');
  });

  it('clearly labels the upstream as a test-only service', () => {
    expect(demoPage).toContain('Protected Test Service');
    expect(demoPage).toContain('TEST-ONLY');
  });
});
