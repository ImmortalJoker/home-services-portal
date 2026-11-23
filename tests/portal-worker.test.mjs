import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { it } from 'node:test';
import assert from 'node:assert/strict';
const script = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker(fetch) {
  let handler;
  runInNewContext(script, { self: { registration: { scope: 'https://portal.example.test/' }, addEventListener: (_type, callback) => { handler = callback; } }, URL, Response, fetch });
  return handler;
}
it('leaves APIs, authentication navigation and third-party requests untouched', () => {
  const handle = worker(() => { throw new Error('Must not fetch'); });
  for (const [mode, path] of [['cors', '/api/session'], ['navigate', '/api/session'], ['navigate', '/outpost.goauthentik.io/sign_out'], ['navigate', '/if/flow/login/'], ['navigate', 'https://other.example.test/']]) {
    handle({ request: { mode, url: new URL(path, 'https://portal.example.test').href }, respondWith: () => assert.fail('Must not intercept') });
  }
});
it('returns a generic non-cached offline page only when portal navigation fails', async () => {
  const handle = worker(async () => { throw new Error('offline'); });
  let response;
  handle({ request: { mode: 'navigate', url: 'https://portal.example.test/' }, respondWith: (promise) => { response = promise; } });
  const offline = await response;
  assert.equal(offline.status, 503);
  assert.equal(offline.headers.get('Cache-Control'), 'no-store');
  const html = await offline.text();
  assert.match(html, /home Wi-Fi or Tailscale/);
  assert.match(html, /color-scheme: light/);
  assert.match(html, /prefers-color-scheme: dark/);
});
