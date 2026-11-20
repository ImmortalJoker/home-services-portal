import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { connect } from 'node:net';
import { createPortalServer } from '../deploy/authentik/portal/server.mjs';

const config = {
  portalName: 'Home Services Portal',
  services: [
    { id: 'public', name: 'Shared demo', url: '/sample', accessGroups: ['Portal - Public'] },
    { id: 'family', name: 'Family demo', url: '/family-check', accessGroups: ['Portal - Family'] },
    { id: 'owner', name: 'Owner diagnostics', url: '/owner-check', accessGroups: ['Portal - Owner'] },
    { id: 'system-metrics', name: 'System status', url: '/api/status', accessGroups: ['Portal - Owner'], widget: 'system-status' },
  ],
};

const systemStatus = {
  cpu_percent: 21.5,
  load_1m: 1.2,
  logical_cores: 8,
  memory_percent: 42,
  memory_used_bytes: 4_500_000_000,
  memory_total_bytes: 10_000_000_000,
  disk_percent: 61,
  disk_free_bytes: 39_000_000_000,
  disk_total_bytes: 100_000_000_000,
  uptime_seconds: 86_400,
  updated_at: 1_760_000_000,
};

let server;
let baseUrl;
let statusFetchCalls = 0;
let requestedStatusHost;

before(async () => {
  server = createPortalServer({
    config,
    distDir: new URL('../dist/', import.meta.url).pathname,
    statusUpstreamUrl: 'http://metrics.internal/api/status',
    statusExternalUrl: 'https://metrics.example.test:8447',
    statusRequester: async (_url, host) => {
      statusFetchCalls += 1;
      requestedStatusHost = host;
      return { statusCode: 200, contentType: 'application/json', payload: systemStatus };
    },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function session(groups, username = 'test-user') {
  const headers = { 'x-authentik-username': username };
  if (groups !== undefined) headers['x-authentik-groups'] = groups;
  return fetch(`${baseUrl}/api/session`, { headers });
}

describe('Authenticated portal service', () => {
  it('returns identity and only Public services to a Public member', async () => {
    const response = await session('Portal - Public');
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.identity.username, 'test-user');
    assert.equal(payload.identity.role, 'Public');
    assert.deepEqual(payload.services.map(({ id }) => id), ['public']);
  });

  it('inherits Public access for Family users but excludes Owner services', async () => {
    const response = await session('Portal - Family');
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.identity.role, 'Family');
    assert.deepEqual(payload.services.map(({ id }) => id), ['public', 'family']);
  });

  it('inherits Public and Family access for Owner users', async () => {
    const response = await session('Portal - Owner');
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.identity.role, 'Owner');
    assert.deepEqual(payload.services.map(({ id }) => id), ['public', 'family', 'owner', 'system-metrics']);
    assert.equal(payload.services.find(({ id }) => id === 'system-metrics').widget, 'system-status');
  });

  it('admits Pending users to the portal atrium without showing services or allowing direct routes', async () => {
    const response = await session('Portal - Pending', 'waiting-user');
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.identity.role, 'Pending');
    assert.deepEqual(payload.identity.groups, ['Portal - Pending']);
    assert.deepEqual(payload.services, []);
    const headers = { 'x-authentik-username': 'waiting-user', 'x-authentik-groups': 'Portal - Pending' };
    for (const path of ['/sample', '/family-check', '/owner-check']) {
      assert.equal((await fetch(`${baseUrl}${path}`, { headers })).status, 403);
    }
  });

  it('preserves Cyrillic display names from Authentik UTF-8 header bytes', async () => {
    const port = server.address().port;
    const responseBuffer = await new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      const timeout = setTimeout(() => socket.destroy(new Error('Raw HTTP request timed out')), 3000);
      const chunks = [];
      socket.on('connect', () => socket.write(Buffer.concat([
        Buffer.from(`GET /api/session HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nX-Authentik-Username: test-user\r\nX-Authentik-Groups: Portal - Pending\r\nX-Authentik-Name: `, 'latin1'),
        Buffer.from('Егор Краснов', 'utf8'),
        Buffer.from('\r\nConnection: close\r\n\r\n', 'latin1'),
      ])));
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('end', () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks));
      });
      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    const separator = responseBuffer.indexOf(Buffer.from('\r\n\r\n'));
    assert.notEqual(separator, -1);
    const payload = JSON.parse(responseBuffer.subarray(separator + 4).toString('utf8'));
    assert.equal(payload.identity.name, 'Егор Краснов');
  });

  it('unlocks only approved group access when a Pending user receives Public membership', async () => {
    const response = await session('Portal - Pending|Portal - Public', 'approved-user');
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.identity.role, 'Public');
    assert.deepEqual(payload.identity.groups, ['Portal - Public']);
    assert.deepEqual(payload.services.map(({ id }) => id), ['public']);
  });

  it('denies Owner and Family routes to Public users even when requested directly', async () => {
    const headers = { 'x-authentik-username': 'public-user', 'x-authentik-groups': 'Portal - Public' };
    assert.equal((await fetch(`${baseUrl}/owner-check`, { headers })).status, 403);
    assert.equal((await fetch(`${baseUrl}/family-check`, { headers })).status, 403);
  });

  it('denies normalized and trailing-slash variants of protected routes', async () => {
    const headers = { 'x-authentik-username': 'public-user', 'x-authentik-groups': 'Portal - Public' };
    assert.equal((await fetch(`${baseUrl}/owner-check/`, { headers })).status, 403);
    assert.equal((await fetch(`${baseUrl}/%6fwner-check`, { headers })).status, 403);
  });

  it('allows Owner users to access the Owner-only route directly', async () => {
    const headers = { 'x-authentik-username': 'owner-user', 'x-authentik-groups': 'Portal - Owner' };
    const response = await fetch(`${baseUrl}/owner-check`, { headers });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /owner-user/);
  });

  it('returns the configured system status to Owners and sends the upstream Host header', async () => {
    statusFetchCalls = 0;
    requestedStatusHost = undefined;
    const response = await fetch(`${baseUrl}/api/system-status`, {
      headers: { 'x-authentik-username': 'owner-user', 'x-authentik-groups': 'Portal - Owner' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), systemStatus);
    assert.equal(statusFetchCalls, 1);
    assert.equal(requestedStatusHost, 'metrics.example.test:8447');
  });

  it('denies non-Owners from system status without contacting the metrics upstream', async () => {
    statusFetchCalls = 0;
    for (const group of ['Portal - Public', 'Portal - Family']) {
      const response = await fetch(`${baseUrl}/api/system-status`, {
        headers: { 'x-authentik-username': 'non-owner', 'x-authentik-groups': group },
      });
      assert.equal(response.status, 403);
    }
    assert.equal(statusFetchCalls, 0);
  });

  it('requires an authenticated identity and a recognized portal group', async () => {
    assert.equal((await fetch(`${baseUrl}/api/session`)).status, 401);
    assert.equal((await session('Unrelated Group')).status, 403);
    assert.equal((await session(undefined)).status, 403);
  });

  it('serves install metadata and the Apple touch icon with install-compatible content types', async () => {
    const htmlResponse = await fetch(`${baseUrl}/`);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    assert.match(html, /rel="manifest"/);
    assert.match(html, /rel="manifest"[^>]*crossorigin="use-credentials"/);
    assert.match(html, /apple-mobile-web-app-capable/);

    const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifestResponse.status, 200);
    assert.ok((manifestResponse.headers.get('content-type') ?? '').startsWith('application/manifest+json'));
    const manifest = await manifestResponse.json();
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.name, 'Home Services Portal');
    assert.ok(manifest.icons.some(({ sizes }) => sizes === '192x192'));
    assert.ok(manifest.icons.some(({ sizes }) => sizes === '512x512'));
    assert.ok(manifest.icons.some(({ purpose }) => purpose.includes('maskable')));

    const iconResponse = await fetch(`${baseUrl}/apple-touch-icon.png`);
    assert.equal(iconResponse.status, 200);
    assert.ok((iconResponse.headers.get('content-type') ?? '').startsWith('image/png'));
    const iconBytes = Buffer.from(await iconResponse.arrayBuffer());
    assert.deepEqual([...iconBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const worker = await fetch(`${baseUrl}/sw.js`);
    assert.equal(worker.status, 200);
    assert.match(worker.headers.get('content-type'), /javascript/);
  });
});
