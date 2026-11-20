import assert from 'node:assert/strict';
import { it } from 'node:test';
import { summarizeTorrents } from '../deploy/authentik/portal/transmission.mjs';
import { createPortalServer } from '../deploy/authentik/portal/server.mjs';
it('computes weighted completion and running counts without returning torrent data', () => {
  const summary = summarizeTorrents([
    { status: 4, sizeWhenDone: 100, leftUntilDone: 20, rateDownload: 1000, rateUpload: 20, name: 'must-not-leak' },
    { status: 0, sizeWhenDone: 300, leftUntilDone: 300, rateDownload: 0, rateUpload: 0 },
  ]);
  assert.deepEqual(summary, { active: 1, total: 2, percent: 20, download_bps: 1000, upload_bps: 20 });
  assert.equal(summarizeTorrents([]).percent, null);
  assert.throws(() => summarizeTorrents([{ status: -1 }]));
});
it('exposes only aggregate fields to Owners and never contacts RPC for other roles', async () => {
  let calls = 0;
  const server = createPortalServer({ config: { portalName: 'Test', services: [{ id: 'transmission', name: 'Transmission', url: 'https://downloads.example.test/transmission/web/', accessGroups: ['Portal - Owner'] }] }, distDir: new URL('../dist/', import.meta.url).pathname,
    transmissionRequester: async () => { calls++; return { active: 1, total: 2, percent: 20, download_bps: 1000, upload_bps: 20, names: ['must-not-leak'] }; } });
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
    assert.deepEqual(Object.keys(await r.json()), ['active', 'total', 'percent', 'download_bps', 'upload_bps']);
    assert.match(r.headers.get('content-security-policy'), /frame-src https:\/\/downloads.example.test/);
    assert.equal((await fetch(base + '/api/transmission-status', { method: 'POST', headers })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
it('rejects a Transmission service configured for household access', () => {
  assert.throws(() => createPortalServer({ config: { portalName: 'Test', services: [{ id: 'transmission', name: 'Transmission', url: 'https://downloads.example.test/', accessGroups: ['Portal - Public'] }] } }));
});
