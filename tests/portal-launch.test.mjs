import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { createPortalServer, validatePortalConfig, filterServices } from '../deploy/authentik/portal/server.mjs';

const config = {
  portalName: 'Launch test',
  services: [
    { id: 'audiobookshelf', name: 'Audio', url: 'https://audio.example.test/', accessGroups: ['Portal - Public'], launch: { android: 'audiobookshelf', ios: 'audiobooth' } },
    { id: 'immich', name: 'Photos', url: 'https://photos.example.test/', accessGroups: ['Portal - Owner'], launch: { android: 'immich', ios: 'immich' } },
  ],
};
let server, base;
before(async () => {
  server = createPortalServer({ config, distDir: new URL('../dist/', import.meta.url).pathname });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

it('filters launch metadata with service permissions before responding', async () => {
  for (const [group, ids] of [['Portal - Public', ['audiobookshelf']], ['Portal - Family', ['audiobookshelf']], ['Portal - Owner', ['audiobookshelf', 'immich']], ['Portal - Pending', []]]) {
    const response = await fetch(`${base}/api/session`, { headers: { 'x-authentik-username': 'synthetic-test', 'x-authentik-groups': group } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.services.map(service => service.id), ids);
    for (const service of payload.services) assert.deepEqual(service.launch, config.services.find(item => item.id === service.id).launch);
  }
  assert.equal((await fetch(`${base}/api/session`)).status, 401);
});
it('rejects unapproved launch metadata on the server too', () => {
  for (const launch of [{ ios: 'javascript:alert(1)' }, { android: 'immich' }, { ios: 'constructor' }]) {
    assert.throws(() => validatePortalConfig({ ...config, services: [{ ...config.services[0], launch }] }));
  }
});
it('validates OPDS metadata and filters it with its parent service permissions', () => {
  const service = { id: 'books-library', name: 'Books', url: 'https://books.example.test/', accessGroups: ['Portal - Owner'], opdsUrl: 'https://books.example.test:8452/opds' };
  const validated = validatePortalConfig({ portalName: 'Test', services: [service] });
  assert.equal(filterServices(validated.services, ['Portal - Public']).length, 0);
  assert.equal(filterServices(validated.services, ['Portal - Owner'])[0].opdsUrl, service.opdsUrl);
  for (const opdsUrl of ['javascript:alert(1)', 'http://books.example.test/', 'https://user:secret@books.example.test/', 123]) {
    assert.throws(() => validatePortalConfig({ portalName: 'Test', services: [{ ...service, opdsUrl }] }));
  }
});
it('filters private setup guides with their parent service and validates their fields', () => {
  const guides = { ios: { title: 'Owner instructions', connectionUrl: 'https://owner.example.test/', steps: ['Owner-only setup.'] } };
  const service = { id: 'owner-guide', name: 'Owner service', url: 'https://owner.example.test/', accessGroups: ['Portal - Owner'], guides };
  const cfg = validatePortalConfig({ portalName: 'Test', services: [service] });
  assert.deepEqual(filterServices(cfg.services, ['Portal - Family']), []);
  assert.deepEqual(filterServices(cfg.services, ['Portal - Owner'])[0].guides, guides);
  for (const invalid of [{ ios: { ...guides.ios, password: 'forbidden' } }, { ios: { ...guides.ios, downloadUrl: 'data:text/html,bad' } }]) {
    assert.throws(() => validatePortalConfig({ portalName: 'Test', services: [{ ...service, guides: invalid }] }));
  }
});
