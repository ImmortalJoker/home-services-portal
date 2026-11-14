import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAuthentikBlueprint } from './helpers/authentikBlueprint';

const blueprint = loadAuthentikBlueprint();
const compose = readFileSync(resolve(process.cwd(), 'deploy/authentik/compose.yml'), 'utf8');
const groups = blueprint.entries.filter((entry) => entry.model === 'authentik_core.group');

describe('portal access-group blueprint', () => {
  it('seeds Public, Family, Owner, and Pending portal groups', () => {
    expect(groups.map((group) => group.identifiers?.name).sort()).toEqual([
      'Portal - Family',
      'Portal - Owner',
      'Portal - Pending',
      'Portal - Public',
    ]);
  });

  it('never grants superuser status to portal groups', () => {
    expect(groups).toHaveLength(4);
    expect(groups.every((group) => group.attrs?.is_superuser === false)).toBe(true);
  });

  it('mounts the version-controlled blueprint read-only into the worker', () => {
    expect(compose).toContain('./blueprints/portal-access-groups.yaml:/blueprints/portal-access-groups.yaml:ro');
  });
});
