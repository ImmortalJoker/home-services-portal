import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const blueprint = readFileSync(resolve(process.cwd(), 'deploy/authentik/blueprints/portal-access-groups.yaml'), 'utf8');
const compose = readFileSync(resolve(process.cwd(), 'deploy/authentik/compose.yml'), 'utf8');

describe('portal access-group blueprint', () => {
  it('seeds only the planned public, family, and owner groups', () => {
    expect(blueprint).toContain('name: Portal - Public');
    expect(blueprint).toContain('name: Portal - Family');
    expect(blueprint).toContain('name: Portal - Owner');
  });

  it('never grants superuser status to portal groups', () => {
    expect((blueprint.match(/is_superuser: false/g) ?? []).length).toBe(3);
    expect(blueprint).not.toContain('is_superuser: true');
  });

  it('mounts the version-controlled blueprint read-only into the worker', () => {
    expect(compose).toContain('./blueprints/portal-access-groups.yaml:/blueprints/portal-access-groups.yaml:ro');
  });
});
