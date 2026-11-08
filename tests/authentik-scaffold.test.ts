import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(resolve(process.cwd(), 'deploy/authentik/compose.yml'), 'utf8');
const setup = readFileSync(resolve(process.cwd(), 'deploy/authentik/setup-local.sh'), 'utf8');
const gitignore = readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8');

describe('local identity-provider scaffold', () => {
  it('binds the setup UI to loopback only', () => {
    expect(compose).toContain('127.0.0.1:9000:9000');
    expect(compose).not.toMatch(/-\s*["']?9000:9000/);
  });

  it('does not mount the Docker socket into the identity provider', () => {
    expect(compose).not.toContain('/var/run/docker.sock');
  });

  it('pins the authentik image rather than tracking latest', () => {
    expect(compose).toContain('ghcr.io/goauthentik/server:2026.8.5');
    expect(compose).not.toContain(':latest');
  });

  it('creates secrets locally and refuses to overwrite existing ones', () => {
    expect(setup).toContain('if [ -e .env ]');
    expect(setup).toContain('openssl rand');
  });

  it('seeds an empty optional external URL instead of publishing a guessed host', () => {
    expect(setup).toContain('PORTAL_TEST_EXTERNAL_HOST=\\n');
    expect(readFileSync(resolve(process.cwd(), 'deploy/authentik/.env.example'), 'utf8')).toContain('PORTAL_TEST_EXTERNAL_HOST=');
  });

  it('ignores the local environment file and persistent data', () => {
    expect(gitignore).toContain('deploy/authentik/.env');
    expect(gitignore).toContain('deploy/authentik/data/');
  });
});
