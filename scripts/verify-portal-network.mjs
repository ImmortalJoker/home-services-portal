import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Disposable synthetic services only. Never join an existing network or use live config.
const prefix = `portal-peer-test-${randomBytes(5).toString('hex')}`;
const image = `${prefix}:test`;
const privateNet = `${prefix}-private`, egressNet = `${prefix}-egress`, otherNet = `${prefix}-other`;
const proxy = `${prefix}-proxy`, backend = `${prefix}-backend`;
const directory = mkdtempSync(join(tmpdir(), prefix));
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 });
const client = (network, code) => docker(['run', '--rm', '--network', network, '--entrypoint', 'node', image, '--input-type=module', '-e', code]);
const assertion = `import assert from 'node:assert/strict';`;
const forged = { 'x-authentik-username': 'synthetic-user', 'x-authentik-groups': 'Portal - Owner' };
let hostProbe;
try {
  docker(['build', '--quiet', '-f', 'deploy/authentik/portal/Dockerfile', '-t', image, '.']);
  docker(['network', 'create', '--internal', privateNet]);
  docker(['network', 'create', egressNet]);
  docker(['network', 'create', otherNet]);
  docker(['run', '-d', '--name', proxy, '--network', privateNet, '--network-alias', 'portal-auth-proxy', '--entrypoint', 'node', image, '-e', 'setInterval(()=>{},10000)']);
  const config = join(directory, 'config.json');
  writeFileSync(config, JSON.stringify({ portalName: 'Synthetic network fixture', services: [
    { id: 'shared', name: 'Shared', url: '/sample', accessGroups: ['Portal - Public'] },
    { id: 'transmission', name: 'Owner', url: 'https://owner.example.test/', accessGroups: ['Portal - Owner'] },
  ] }), { mode: 0o644 });
  docker(['create', '--name', backend, '--network', privateNet, '--network-alias', 'portal-backend', '--network-alias', 'portal-test', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '-e', 'PORTAL_CONFIG_PATH=/fixture.json', '-e', 'PORTAL_BIND_HOST=portal-backend', '-e', 'PORTAL_TRUSTED_PROXY_HOST=portal-auth-proxy',
    '-v', `${config}:/fixture.json:ro`, image]);
  docker(['network', 'connect', egressNet, backend]);
  docker(['start', backend]);
  const addresses = JSON.parse(docker(['inspect', backend]))[0].NetworkSettings.Networks;
  const proxyAddress = JSON.parse(docker(['inspect', proxy]))[0].NetworkSettings.Networks[privateNet].IPAddress;
  assert.equal(Object.keys(JSON.parse(docker(['inspect', backend]))[0].HostConfig.PortBindings ?? {}).length, 0);

  // The fake trusted proxy has a different TCP source from the same-network attacker.
  docker(['exec', proxy, 'node', '--input-type=module', '-e', `${assertion}
    let ready=false;for(let i=0;i<40;i++){try{const r=await fetch('http://portal-backend:8080/');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready);
    const owner=await fetch('http://portal-test:8080/api/session',{headers:${JSON.stringify(forged)}});assert.equal(owner.status,200);assert.equal((await owner.json()).identity.role,'Owner');
    const pub=await fetch('http://portal-test:8080/api/session',{headers:{'x-authentik-username':'synthetic-user','x-authentik-groups':'Portal - Public'}});assert.equal(pub.status,200);assert.deepEqual((await pub.json()).services.map(s=>s.id),['shared']);
  `]);
  console.log('Trusted proxy TCP source: Owner/Public synthetic role checks passed.');

  client(privateNet, `${assertion}
    for(const path of ['/api/session','/api/system-status','/api/transmission-status','/owner-check']){
      const r=await fetch('http://portal-backend:8080'+path,{headers:{...${JSON.stringify(forged)},'x-forwarded-for':'${proxyAddress}','x-real-ip':'${proxyAddress}'}});assert.equal(r.status,401);
    }
  `);
  console.log('Untrusted same-network caller: forged Owner and forwarded headers rejected.');
  for (const [network, address] of [[otherNet, addresses[privateNet].IPAddress], [egressNet, addresses[egressNet].IPAddress]]) {
    client(network, `${assertion}await assert.rejects(fetch('http://${address}:8080/',{signal:AbortSignal.timeout(1500)}));`);
  }
  console.log('Other bridge cannot reach private backend; egress interface has no HTTP listener.');
  if (process.platform === 'darwin') {
    // Docker Desktop's loopback host gateway is needed by the real read-only aggregate clients.
    // Use a fresh local fixture, never the household metrics/RPC listeners.
    hostProbe = createServer((_req, res) => res.end('synthetic-egress-probe'));
    await new Promise(resolve => hostProbe.listen(0, '127.0.0.1', resolve));
    await promisify(execFile)('docker', ['exec', backend, 'node', '--input-type=module', '-e', `${assertion}
      const r=await fetch('http://host.docker.internal:${hostProbe.address().port}/',{signal:AbortSignal.timeout(5000)});assert.equal(await r.text(),'synthetic-egress-probe');
    `], { timeout: 10000 });
    console.log('macOS Docker Desktop: backend egress reaches a synthetic host-loopback aggregate service.');
  }
} finally {
  if (hostProbe?.listening) await new Promise(resolve => hostProbe.close(resolve));
  for (const name of [backend, proxy]) { try { docker(['rm', '-f', name]); } catch {} }
  for (const name of [privateNet, egressNet, otherNet]) { try { docker(['network', 'rm', name]); } catch {} }
  try { docker(['image', 'rm', image]); } catch {}
  rmSync(directory, { recursive: true, force: true });
}
