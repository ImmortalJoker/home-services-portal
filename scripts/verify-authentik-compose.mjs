import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const projectDir = resolve(process.cwd(), 'deploy/authentik');
const composePath = resolve(projectDir, 'compose.yml');
const exampleEnvPath = resolve(projectDir, '.env.example');
const result = spawnSync(
  'docker',
  ['compose', '--project-directory', projectDir, '--env-file', exampleEnvPath, '-f', composePath, 'config', '--format', 'json'],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
);

if (result.error || result.status !== 0) {
  throw new Error('Docker Compose could not resolve the Authentik deployment configuration.');
}

const services = JSON.parse(result.stdout).services;
const publishedServices = Object.entries(services)
  .filter(([, service]) => service.ports?.length)
  .map(([name]) => name)
  .sort();
assert.deepEqual(publishedServices, ['server'], 'Only the Authentik server may publish a host port.');
assert.deepEqual(services.server.ports, [
  { mode: 'ingress', host_ip: '127.0.0.1', target: 9000, published: '9000', protocol: 'tcp' },
]);

for (const name of Object.keys(services)) {
  assert.equal('PG_PASS' in services[name].environment, false, `${name} must not receive the raw database password variable.`);
  const mounts = services[name].volumes ?? [];
  assert.equal(mounts.some((mount) => mount.source?.includes('docker.sock')), false, `${name} must not mount the Docker socket.`);
}
assert.equal('AUTHENTIK_SECRET_KEY' in services.postgresql.environment, false);
assert.equal('AUTHENTIK_SECRET_KEY' in services['portal-test'].environment, false);
assert.equal(services['portal-test'].user, '1000:1000');
assert.equal(services['portal-test'].read_only, true);
assert.deepEqual(services['portal-test'].cap_drop, ['ALL']);
assert.ok(services['portal-test'].security_opt.includes('no-new-privileges:true'));
assert.equal(services['portal-test'].expose[0], '8080');
assert.deepEqual(Object.keys(services['portal-test'].networks).sort(), ['portal_egress', 'portal_private']);
assert.deepEqual(Object.keys(services.server.networks).sort(), ['default', 'portal_private']);
assert.equal(services['portal-test'].environment.PORTAL_BIND_HOST, 'portal-backend');
assert.equal(services['portal-test'].environment.PORTAL_TRUSTED_PROXY_HOST, 'portal-auth-proxy');
assert.ok(services['portal-test'].networks.portal_private.aliases.includes('portal-backend'));
assert.ok(services.server.networks.portal_private.aliases.includes('portal-auth-proxy'));
const privateMembers = Object.entries(services).filter(([, s]) => Object.hasOwn(s.networks ?? {}, 'portal_private')).map(([name]) => name).sort();
assert.deepEqual(privateMembers, ['portal-test', 'server']);
const egressMembers = Object.entries(services).filter(([, s]) => Object.hasOwn(s.networks ?? {}, 'portal_egress')).map(([name]) => name);
assert.deepEqual(egressMembers, ['portal-test']);
assert.equal(JSON.parse(result.stdout).networks.portal_private.internal, true);
assert.ok(services['portal-test'].healthcheck.test.join(' ').includes('http://portal-backend:8080/'));
assert.ok(services['portal-test'].build.dockerfile.endsWith('deploy/authentik/portal/Dockerfile'));
assert.ok(services['portal-test'].volumes.some((mount) => mount.target === '/app/config/portal-services.json' && mount.read_only));
assert.ok(services.worker.volumes.some((mount) => mount.target === '/blueprints/portal-access-groups.yaml' && mount.read_only));
assert.equal(services.worker.environment.PORTAL_BOOKS_EXTERNAL_HOST, '', 'The real-service proxy must remain disabled by default.');
assert.equal(services.worker.environment.PORTAL_AUDIOBOOKSHELF_EXTERNAL_HOST, '', 'The Audiobookshelf proxy must remain disabled by default.');
assert.equal(services.worker.environment.PORTAL_METRICS_EXTERNAL_HOST, '', 'The metrics proxy must remain disabled by default.');
assert.equal(services.worker.environment.PORTAL_GROCY_INTERNAL_HOST, 'http://grocy:80');
assert.equal('PORTAL_GROCY_API_KEY_PATH_REGEX' in services.worker.environment, false, 'The Grocy API skip must not be configurable by environment.');
assert.equal(services.worker.environment.PORTAL_TRANSMISSION_RPC_USERNAME, '', 'Transmission RPC credentials must be blank by default.');
assert.equal(services.worker.environment.PORTAL_TRANSMISSION_RPC_PASSWORD, '', 'Transmission RPC credentials must be blank by default.');
assert.equal(services['portal-test'].environment.PORTAL_STATUS_UPSTREAM_URL, '', 'The status widget upstream must remain disabled by default.');
assert.equal(services['portal-test'].environment.PORTAL_STATUS_EXTERNAL_URL, '', 'The status widget external host must remain empty by default.');

console.log('Resolved Authentik Compose security boundaries are valid.');
