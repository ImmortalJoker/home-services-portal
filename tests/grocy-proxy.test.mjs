import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

const templatePath = new URL('../deploy/authentik/Caddyfile.grocy.example', import.meta.url);
const identity = (headers) => Object.fromEntries(Object.entries(headers)
  .filter(([name]) => name.toLowerCase().startsWith('x-authentik-')));
const spoofed = {
  'X-authentik-uid': 'forged-uid',
  'x-AuThEnTiK-UsErNaMe': 'forged-user',
  'X-Authentik-Groups': 'Portal - Owner',
  'X-Authentik-Jwt': 'forged-jwt',
  'X-Authentik-Future-Claim': 'forged-claim',
};
const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
const unusedPort = async () => {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
};
let caddy, directory, outpost, grocy, ingress, outpostURL;
let apiSkip = false;
beforeEach(() => { apiSkip = false; });
const received = [];

after(async () => {
  if (caddy && caddy.exitCode === null && caddy.signalCode === null) {
    caddy.kill('SIGTERM');
    await once(caddy, 'exit');
  }
  for (const server of [outpost, grocy]) {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

before(async () => {
  // Read first: absence of the safeguard must fail, never skip this suite.
  const template = await readFile(templatePath, 'utf8');
  grocy = createServer((req, res) => {
    const validKey = req.headers['grocy-api-key'] === 'fixture-api-key';
    const validIdentity = Boolean(req.headers['x-authentik-uid']);
    res.writeHead(validKey || validIdentity ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ identity: identity(req.headers), key: req.headers['grocy-api-key'] ?? null }));
  });
  const grocyPort = await listen(grocy);
  outpost = createServer(async (req, res) => {
    received.push({ path: req.url, headers: req.headers });
    const headers = { ...req.headers };
    if (!(apiSkip && req.url.startsWith('/api/'))) {
      if (req.headers.cookie !== 'fixture-session=verified') {
        res.writeHead(302, { location: '/fixture-login' }).end();
        return;
      }
      // Model a verified outpost session adding identity AFTER ingress scrubbing.
      headers['x-authentik-uid'] = 'fixture-verified-uid';
      headers['x-authentik-username'] = 'fixture-family-user';
      headers['x-authentik-groups'] = 'Portal - Family';
    }
    const upstream = await fetch(`http://127.0.0.1:${grocyPort}${req.url}`, { headers });
    res.writeHead(upstream.status, { 'content-type': 'application/json' });
    res.end(await upstream.text());
  });
  const outpostPort = await listen(outpost);
  outpostURL = `http://127.0.0.1:${outpostPort}`;
  const ports = [await unusedPort(), await unusedPort()];
  ingress = ports.map((port) => `http://127.0.0.1:${port}`);
  directory = await mkdtemp(join(tmpdir(), 'grocy-proxy-test-'));
  const config = join(directory, 'Caddyfile');
  // Disable admin/HTTPS only for this isolated fixture, never touch a running Caddy.
  await writeFile(config, `{\n admin off\n auto_https off\n persist_config off\n}\n${template}`);
  let logs = '';
  caddy = spawn(process.env.CADDY_BIN || 'caddy', ['run', '--config', config, '--adapter', 'caddyfile'], {
    env: { ...process.env,
      GROCY_LAN_ADDRESS: ingress[0],
      GROCY_SERVE_ADDRESS: `http://:${ports[1]}`,
      GROCY_OUTPOST_UPSTREAM: `127.0.0.1:${outpostPort}`,
      GROCY_PUBLIC_AUTHORITY: 'grocy.example.test',
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  caddy.stdout.on('data', (chunk) => { logs += chunk; });
  caddy.stderr.on('data', (chunk) => { logs += chunk; });
  const started = new Promise((resolve, reject) => {
    caddy.once('error', reject);
    caddy.once('exit', (code) => reject(new Error(`Fixture Caddy exited (${code}): ${logs}`)));
  });
  await Promise.race([started, (async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await fetch(ingress[0], { redirect: 'manual' }); return; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Fixture Caddy did not start: ${logs}`);
  })()]);
}, { timeout: 10000 });

describe('Grocy sanitizing ingress (real Caddy, fixture outpost/Grocy)', () => {
  it('direct outpost access with API skip bypasses Caddy and forwards forged identity', async () => {
    // Models host.docker.internal:9000; does not probe Docker or production.
    apiSkip = true;
    const response = await fetch(`${outpostURL}/api/objects`, { headers: spoofed });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).identity['x-authentik-uid'], 'forged-uid');
  });
  it('default no-skip outpost requires authentication even on direct API requests', async () => {
    for (const origin of [outpostURL, ...ingress]) {
      const response = await fetch(`${origin}/api/objects`, {
        headers: { ...spoofed, 'GROCY-API-KEY': 'fixture-api-key' }, redirect: 'manual',
      });
      assert.equal(response.status, 302);
    }
  });
  for (const [index, name] of ['LAN', 'tailnet Serve loopback'].entries()) {
    it(`${name}: defense in depth scrubs hypothetical skipped requests (not a supported API gateway)`, async () => {
      apiSkip = true;
      for (const key of [undefined, 'fixture-invalid-key', 'fixture-api-key']) {
        const response = await fetch(`${ingress[index]}/api/objects?fixture=1`, {
          headers: [...Object.entries(spoofed), ['X-AUTHENTIK-UID', 'second-forged-uid'],
            ...(key ? [['GROCY-API-KEY', key]] : [])],
        });
        assert.equal(response.status, key === 'fixture-api-key' ? 200 : 401);
        const payload = await response.json();
        assert.deepEqual(payload.identity, {});
        assert.equal(payload.key, key ?? null);
        const request = received.at(-1);
        assert.deepEqual(identity(request.headers), {});
        assert.equal(request.headers.host, 'grocy.example.test');
        assert.equal(request.headers['x-forwarded-proto'], 'https');
      }
    });
    it(`${name}: UI requires a session and the outpost can supply verified identity`, async () => {
      const denied = await fetch(ingress[index], { headers: spoofed, redirect: 'manual' });
      assert.equal(denied.status, 302);
      const allowed = await fetch(ingress[index], {
        headers: { ...spoofed, cookie: 'fixture-session=verified' },
      });
      assert.equal(allowed.status, 200);
      assert.deepEqual((await allowed.json()).identity, {
        'x-authentik-uid': 'fixture-verified-uid',
        'x-authentik-username': 'fixture-family-user',
        'x-authentik-groups': 'Portal - Family',
      });
      assert.deepEqual(identity(received.at(-1).headers), {});
    });
  }
});
