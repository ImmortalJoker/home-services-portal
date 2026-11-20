import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createPortalServer } from '../deploy/authentik/portal/server.mjs';
import { isTrustedProxy, resolveProxyAddresses } from '../deploy/authentik/portal/peer-trust.mjs';

const config = { portalName: 'Test', services: [{ id: 'transmission', name: 'Transmission', url: 'https://owner.example.test/', accessGroups: ['Portal - Owner'] }] };
const forged = { 'x-authentik-username': 'forged', 'x-authentik-groups': 'Portal - Owner', 'x-forwarded-for': '192.0.2.9', 'x-real-ip': '192.0.2.9' };
async function fixture(options, fn) {
  const server = createPortalServer({ config, distDir: new URL('../dist/', import.meta.url).pathname, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
it('defaults to denying identity headers from every TCP peer', async () => {
  let rpcCalls = 0;
  await fixture({ transmissionRequester: async () => { rpcCalls++; } }, async base => {
    for (const path of ['/api/session', '/api/system-status', '/api/transmission-status', '/owner-check']) {
      const r = await fetch(base + path, { headers: forged });
      assert.equal(r.status, 401);
      assert.doesNotMatch(r.headers.get('content-security-policy'), /owner\.example\.test/);
    }
    assert.equal(rpcCalls, 0);
  });
});
it('uses socket source only and ignores forged forwarded-address headers', async () => {
  await fixture({ trustedProxyAddresses: ['192.0.2.9'] }, async base => {
    assert.equal((await fetch(base + '/api/session', { headers: forged })).status, 401);
  });
});
it('refreshes proxy addresses and fails closed if resolution disappears or fails', async () => {
  let mode = 'trusted';
  await fixture({ resolveTrustedProxyAddresses: async () => { if (mode === 'error') throw new Error('DNS failed'); return mode === 'trusted' ? ['127.0.0.1'] : []; } }, async base => {
    assert.equal((await fetch(base + '/api/session', { headers: forged })).status, 200);
    mode = 'empty'; assert.equal((await fetch(base + '/api/session', { headers: forged })).status, 401);
    mode = 'error'; assert.equal((await fetch(base + '/api/session', { headers: forged })).status, 401);
  });
});
it('normalizes mapped IPv4 while rejecting wildcards and missing proxy DNS', async () => {
  assert.equal(isTrustedProxy('::ffff:192.0.2.9', ['192.0.2.9']), true);
  assert.equal(isTrustedProxy('192.0.2.8', ['192.0.2.9']), false);
  assert.equal(isTrustedProxy('0.0.0.0', ['0.0.0.0']), false);
  assert.equal(isTrustedProxy('::', ['::']), false);
  assert.deepEqual(await resolveProxyAddresses(''), []);
  assert.deepEqual(await resolveProxyAddresses('proxy', async () => { throw new Error('DNS failed'); }), []);
});
