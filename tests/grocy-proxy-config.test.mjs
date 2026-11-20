import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const config = JSON.parse(execFileSync(process.env.CADDY_BIN || 'caddy', [
  'adapt', '--adapter', 'caddyfile', '--config', 'deploy/authentik/Caddyfile.grocy.example',
], { encoding: 'utf8', env: {
  ...process.env,
  GROCY_LAN_ADDRESS: 'https://grocy.example.test',
  GROCY_SERVE_ADDRESS: 'http://:9080',
  GROCY_OUTPOST_UPSTREAM: '127.0.0.1:9000',
  GROCY_PUBLIC_AUTHORITY: 'grocy.example.test',
} }));
function proxies(value) {
  if (!value || typeof value !== 'object') return [];
  return [ ...(value.handler === 'reverse_proxy' ? [value] : []),
    ...Object.values(value).flatMap(proxies) ];
}

test('both adapted ingress routes unconditionally delete the entire Authentik request-header namespace', () => {
  const servers = Object.values(config.apps.http.servers);
  assert.equal(servers.length, 2);
  assert.ok(servers.some((server) => server.listen.includes('127.0.0.1:9080')));
  for (const server of servers) {
    const handlers = proxies(server);
    assert.equal(handlers.length, 1);
    const proxy = handlers[0];
    assert.deepEqual(proxy.upstreams, [{ dial: '127.0.0.1:9000' }]);
    assert.ok(proxy.headers?.request?.delete?.some((name) => name.toLowerCase() === 'x-authentik-*'),
      'missing wildcard header scrubbing before the outpost');
    assert.equal(proxy.headers.response, undefined, 'verified downstream identity must remain untouched');
    assert.deepEqual(proxy.headers.request.set.Host, ['grocy.example.test']);
    // No API path matcher may make the scrub conditional.
    assert.doesNotMatch(JSON.stringify(server), /"path"/);
  }
  const loopback = servers.find((server) => server.listen.includes('127.0.0.1:9080'));
  assert.doesNotMatch(JSON.stringify(loopback), /"host"/, 'Serve preserves its public Host; loopback must accept it');
});

test('Grocy provider uses a configurable service URL and cannot enable API skip', () => {
  const compose = parse(readFileSync('deploy/authentik/compose.yml', 'utf8'));
  const blueprint = readFileSync('deploy/authentik/blueprints/portal-access-groups.yaml', 'utf8');
  const provider = blueprint.split('id: portal-grocy-provider')[1].split('  - model:')[0];
  assert.doesNotMatch(provider, /host\.docker\.internal:9283/);
  assert.match(provider, /internal_host: !Env PORTAL_GROCY_INTERNAL_HOST/);
  assert.equal(compose.services.worker.environment.PORTAL_GROCY_INTERNAL_HOST,
    '${PORTAL_GROCY_INTERNAL_HOST:-http://grocy:80}');
  assert.match(provider, /skip_path_regex: ""/);
  assert.doesNotMatch(provider, /!Env PORTAL_GROCY_API_KEY_PATH_REGEX/);
});

test('opt-in private network has only Grocy and embedded outpost, with no Grocy host gateway', () => {
  const base = parse(readFileSync('deploy/authentik/compose.yml', 'utf8'));
  const docs = readFileSync('deploy/authentik/README.md', 'utf8');
  assert.match(docs, /\[compose\.grocy\.yml\]\(compose\.grocy\.yml\)/, 'safe deployment must use the tested overlay');
  const overlay = parse(readFileSync('deploy/authentik/compose.grocy.yml', 'utf8'));
  assert.equal(base.services.grocy, undefined, 'ordinary deployments must not require Grocy');
  assert.equal(base.networks?.grocy_private, undefined);
  assert.equal(overlay.networks.grocy_private.internal, true);
  const merged = { ...base.services, ...overlay.services,
    server: { ...base.services.server, ...overlay.services.server } };
  const networks = (service) => Array.isArray(service.networks)
    ? service.networks : Object.keys(service.networks ?? {});
  const members = Object.entries(merged).filter(([, service]) =>
    networks(service).includes('grocy_private')).map(([name]) => name).sort();
  assert.deepEqual(members, ['grocy', 'server']);
  assert.deepEqual(Object.keys(merged.grocy.networks), ['grocy_private']);
  assert.deepEqual(merged.grocy.environment, {
    PUID: '${GROCY_PUID:?Set the existing Grocy UID}',
    PGID: '${GROCY_PGID:?Set the existing Grocy GID}',
    TZ: '${GROCY_TZ:?Set the existing Grocy timezone}',
  }, 'the isolated replacement must preserve the existing container identity and timezone');
  assert.ok(merged.grocy.networks.grocy_private.aliases.includes('grocy'));
  assert.ok(Object.hasOwn(merged.server.networks, 'default'), 'outpost still needs Authentik dependencies');
  assert.ok(!merged.grocy.ports?.length, 'Grocy must have no published ports, including loopback');
  assert.ok(!merged.grocy.network_mode, 'Grocy must not share the host network');
  // Static reachability model derived from the deployment, NOT a Docker networking test.
  // Host-gateway only exposes published services; non-members cannot use private DNS/routes.
  const viaHostGateway = (service) => Boolean(service.ports?.length || service.network_mode === 'host');
  const nonMember = merged['portal-test'];
  assert.ok(!networks(nonMember).includes('grocy_private'));
  assert.equal(viaHostGateway(merged.grocy), false, 'non-member must have no Grocy host-gateway route');
  assert.equal(viaHostGateway(merged.server), true, 'loopback outpost publication is still a bypass of Caddy');
});
