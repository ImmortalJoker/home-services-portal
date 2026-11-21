import assert from 'node:assert/strict';
import { it } from 'node:test';
import { summarizeTorrents } from '../deploy/authentik/portal/transmission.mjs';
import { createPortalServer } from '../deploy/authentik/portal/server.mjs';
it('computes weighted completion, downloading and active counts without returning torrent data', () => {
  const summary = summarizeTorrents([
    { status: 4, sizeWhenDone: 100, leftUntilDone: 20, rateDownload: 1000, rateUpload: 20, name: 'must-not-leak' },
    { status: 6, sizeWhenDone: 100, leftUntilDone: 0, rateDownload: 0, rateUpload: 0 },
    { status: 0, sizeWhenDone: 300, leftUntilDone: 300, rateDownload: 0, rateUpload: 0 },
  ]);
  // The seeding torrent (status 6) is active but not downloading.
  assert.deepEqual(summary, { downloading: 1, active: 2, total: 3, percent: 36, download_bps: 1000, upload_bps: 20 });
  assert.equal(summarizeTorrents([]).percent, null);
  assert.throws(() => summarizeTorrents([{ status: -1 }]));
});
it('exposes only aggregate fields to Owners and never contacts RPC for other roles', async () => {
  let calls = 0;
  const server = createPortalServer({ trustedProxyAddresses: ['127.0.0.1'], config: { portalName: 'Test', services: [{ id: 'transmission', name: 'Transmission', url: 'https://downloads.example.test/transmission/web/', accessGroups: ['Portal - Owner'] }] }, distDir: new URL('../dist/', import.meta.url).pathname,
    transmissionRequester: async () => { calls++; return { downloading: 1, active: 1, total: 2, percent: 20, download_bps: 1000, upload_bps: 20, names: ['must-not-leak'] }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const role of ['Public', 'Family', 'Pending']) {
      const r = await fetch(base + '/api/transmission-status', { headers: { 'x-authentik-username': 'fixture', 'x-authentik-groups': `Portal - ${role}` } });
      assert.equal(r.status, 403);
      assert.doesNotMatch(r.headers.get('content-security-policy'), /downloads\.example\.test/);
    }
    assert.equal((await fetch(base + '/api/transmission-status')).status, 401);
    assert.equal(calls, 0);
    const headers = { 'x-authentik-username': 'fixture', 'x-authentik-groups': 'Portal - Owner' };
    const r = await fetch(base + '/api/transmission-status', { headers });
    assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(await r.json()), ['downloading', 'active', 'total', 'percent', 'download_bps', 'upload_bps']);
    assert.match(r.headers.get('content-security-policy'), /frame-src https:\/\/downloads.example.test/);
    assert.equal((await fetch(base + '/api/transmission-status', { method: 'POST', headers })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
it('rejects a Transmission service configured for household access', () => {
  assert.throws(() => createPortalServer({ trustedProxyAddresses: ['127.0.0.1'], config: { portalName: 'Test', services: [{ id: 'transmission', name: 'Transmission', url: 'https://downloads.example.test/', accessGroups: ['Portal - Public'] }] } }));
});
it('requestJson sends the caller-supplied Host header and caps the response body', async () => {
  const { createServer } = await import('node:http');
  const { requestJson } = await import('../deploy/authentik/portal/http.mjs');
  const upstream = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(req.url === '/big' ? JSON.stringify({ pad: 'x'.repeat(2048) }) : JSON.stringify({ host: req.headers.host }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${upstream.address().port}`;
  try {
    const { statusCode, payload } = await requestJson(`${base}/`, { headers: { Host: 'localhost:9091' } });
    assert.equal(statusCode, 200);
    assert.equal(payload.host, 'localhost:9091');
    await assert.rejects(requestJson(`${base}/big`, { maxBytes: 1024 }), /size limit/);
  } finally { await new Promise(resolve => upstream.close(resolve)); }
});
it('requestTransmissionSummary completes the session handshake with a loopback Host header', async () => {
  const { requestTransmissionSummary } = await import('../deploy/authentik/portal/transmission.mjs');
  const saved = Object.fromEntries(RPC_ENV_KEYS.map(k => [k, process.env[k]]));
  const seen = [];
  const request = async (_url, options) => {
    seen.push({ ...options.headers });
    if (!options.headers['X-Transmission-Session-Id']) return { statusCode: 409, headers: { 'x-transmission-session-id': 'sid-1' }, payload: null };
    return { statusCode: 200, headers: {}, payload: { result: 'success', arguments: { torrents: [{ status: 4, sizeWhenDone: 10, leftUntilDone: 5, rateDownload: 1, rateUpload: 0 }] } } };
  };
  await withRpcEnv({}, async () => {
    const summary = await requestTransmissionSummary({ request });
    assert.equal(summary.downloading, 1);
    assert.equal(seen.length, 2);
    assert.ok(seen.every(h => h.Host === 'localhost:9091'));
    assert.equal(seen[1]['X-Transmission-Session-Id'], 'sid-1');
  });
  assert.ok(RPC_ENV_KEYS.every(k => process.env[k] === saved[k]), 'RPC environment must be restored');
});
const RPC_ENV_KEYS = ['PORTAL_TRANSMISSION_RPC_USERNAME', 'PORTAL_TRANSMISSION_RPC_PASSWORD', 'PORTAL_TRANSMISSION_RPC_URL'];
async function withRpcEnv(values, fn) {
  const saved = Object.fromEntries(RPC_ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of RPC_ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { PORTAL_TRANSMISSION_RPC_USERNAME: 'fixture-user', PORTAL_TRANSMISSION_RPC_PASSWORD: 'fixture-pass' }, values);
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
function recordingRequest(seen) {
  return async (url, options) => {
    seen.push({ url, host: options.headers.Host });
    return { statusCode: 200, headers: {}, payload: { result: 'success', arguments: { torrents: [] } } };
  };
}
it('keeps the host-gateway Transmission RPC default when PORTAL_TRANSMISSION_RPC_URL is unset or blank', async () => {
  const { requestTransmissionSummary, DEFAULT_TRANSMISSION_RPC_URL } = await import('../deploy/authentik/portal/transmission.mjs');
  assert.equal(DEFAULT_TRANSMISSION_RPC_URL, 'http://host.docker.internal:9091/transmission/rpc');
  for (const values of [{}, { PORTAL_TRANSMISSION_RPC_URL: '' }, { PORTAL_TRANSMISSION_RPC_URL: '   ' }]) {
    const seen = [];
    await withRpcEnv(values, () => requestTransmissionSummary({ request: recordingRequest(seen) }));
    assert.deepEqual(seen, [{ url: DEFAULT_TRANSMISSION_RPC_URL, host: 'localhost:9091' }]);
  }
});
it('sends the configured authority as Host for a valid PORTAL_TRANSMISSION_RPC_URL override', async () => {
  const { requestTransmissionSummary } = await import('../deploy/authentik/portal/transmission.mjs');
  const cases = [
    [' http://transmission.example.test:19091/custom/rpc ', 'http://transmission.example.test:19091/custom/rpc', 'transmission.example.test:19091'],
    ['https://transmission.example.test/transmission/rpc', 'https://transmission.example.test/transmission/rpc', 'transmission.example.test'],
    ['https://transmission.example.test:443/transmission/rpc', 'https://transmission.example.test/transmission/rpc', 'transmission.example.test'],
    ['http://[::1]:19091/transmission/rpc', 'http://[::1]:19091/transmission/rpc', '[::1]:19091'],
  ];
  for (const [value, url, host] of cases) {
    const seen = [];
    await withRpcEnv({ PORTAL_TRANSMISSION_RPC_URL: value }, () => requestTransmissionSummary({ request: recordingRequest(seen) }));
    assert.deepEqual(seen, [{ url, host }]);
  }
});
it('rejects unsafe PORTAL_TRANSMISSION_RPC_URL overrides before contacting RPC and without echoing them', async () => {
  const { requestTransmissionSummary } = await import('../deploy/authentik/portal/transmission.mjs');
  const unsafe = [
    'not a url',
    '/transmission/rpc',
    'ftp://transmission.example.test/rpc',
    'file:///etc/passwd',
    'http://fixture-user:fixture-pass@transmission.example.test:9091/transmission/rpc',
    'http://transmission.example.test:9091/transmission/rpc?x=secret-marker',
    'http://transmission.example.test:9091/transmission/rpc#secret-marker',
  ];
  for (const value of unsafe) {
    const seen = [];
    await assert.rejects(
      withRpcEnv({ PORTAL_TRANSMISSION_RPC_URL: value }, () => requestTransmissionSummary({ request: recordingRequest(seen) })),
      (error) => {
        assert.match(error.message, /PORTAL_TRANSMISSION_RPC_URL/);
        assert.ok(!error.message.includes(value.trim()) && !/fixture-pass|secret-marker/.test(error.message));
        return true;
      },
    );
    assert.equal(seen.length, 0);
  }
});
