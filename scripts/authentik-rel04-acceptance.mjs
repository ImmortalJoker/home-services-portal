import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants as fsConstants, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  buildOptionalProviderVerification, OPTIONAL_PROVIDERS,
} from './authentik-runtime-optional-providers.mjs';

const root = resolve(import.meta.dirname, '..');
const blueprintPath = '/tmp/rel04-portal-fixture.yaml';
const dummyUpstream = (source) => source.replaceAll('http://host.docker.internal:', 'http://upstream.rel04.test:');
const secret = () => randomBytes(32).toString('hex');
const baseProvider = 'Portal Test Protected Service Provider';
const expectedMappingFailure = 'optional provider transmission: missing required managed proxy mapping for upstream basic auth';

export function buildFixture() {
  const pgPassword = secret();
  const authentikEnv = {
    AUTHENTIK_POSTGRESQL__HOST: 'postgresql',
    AUTHENTIK_POSTGRESQL__NAME: 'rel04',
    AUTHENTIK_POSTGRESQL__USER: 'rel04',
    AUTHENTIK_POSTGRESQL__PASSWORD: pgPassword,
    AUTHENTIK_SECRET_KEY: secret(),
  };
  const depends_on = { postgresql: { condition: 'service_healthy' } };
  const services = {
    postgresql: {
      image: 'docker.io/library/postgres:16-alpine',
      environment: { POSTGRES_DB: 'rel04', POSTGRES_USER: 'rel04', POSTGRES_PASSWORD: pgPassword },
      volumes: [{ type: 'volume', source: 'database', target: '/var/lib/postgresql/data' }],
      healthcheck: {
        // PostgreSQL's temporary initialization server only listens on a Unix socket.
        test: ['CMD', 'pg_isready', '-h', '127.0.0.1', '-U', 'rel04', '-d', 'rel04'],
        interval: '2s',
        timeout: '3s',
        retries: 30,
      },
    },
  };
  const optionalEnv = {
    PORTAL_BOOKS_EXTERNAL_HOST: 'https://books.rel04.test',
    PORTAL_AUDIOBOOKSHELF_EXTERNAL_HOST: 'https://audio.rel04.test',
    PORTAL_METRICS_EXTERNAL_HOST: 'https://metrics.rel04.test',
    PORTAL_TRANSMISSION_EXTERNAL_HOST: 'https://transmission.rel04.test',
    PORTAL_TRANSMISSION_RPC_USERNAME: 'rel04-dummy-rpc-user',
    PORTAL_TRANSMISSION_RPC_PASSWORD: secret(),
    PORTAL_GROCY_EXTERNAL_HOST: 'https://grocy.rel04.test',
    PORTAL_GROCY_INTERNAL_HOST: 'http://upstream.rel04.test:8080',
    PORTAL_AUDIOBOOKSHELF_OIDC_CLIENT_SECRET: secret(),
    PORTAL_AUDIOBOOKSHELF_OIDC_WEB_CALLBACK_URL: 'https://audio.rel04.test/auth/openid/callback',
    PORTAL_AUDIOBOOKSHELF_OIDC_MOBILE_CALLBACK_URL: 'https://audio.rel04.test/auth/openid/mobile-redirect',
    PORTAL_AUDIOBOOKSHELF_OIDC_LOGOUT_CALLBACK_URL: 'https://audio.rel04.test/logout',
    PORTAL_IMMICH_OIDC_CLIENT_SECRET: secret(),
    PORTAL_IMMICH_OIDC_WEB_LOGIN_CALLBACK_URL: 'https://photos.rel04.test/auth/login',
    PORTAL_IMMICH_OIDC_WEB_LINK_CALLBACK_URL: 'https://photos.rel04.test/user-settings',
    PORTAL_IMMICH_OIDC_LAN_LOGIN_CALLBACK_URL: 'http://photos-lan.rel04.test/auth/login',
    PORTAL_IMMICH_OIDC_LAN_LINK_CALLBACK_URL: 'http://photos-lan.rel04.test/user-settings',
    PORTAL_IMMICH_OIDC_MOBILE_CALLBACK_URL: 'app.immich:///oauth-callback',
  };
  for (const role of ['server', 'worker']) {
    services[role] = {
      image: 'ghcr.io/goauthentik/server:2026.8.5',
      command: role,
      depends_on,
      shm_size: '512m',
      environment: { ...authentikEnv },
    };
  }
  Object.assign(services.worker.environment, optionalEnv, { PORTAL_TEST_EXTERNAL_HOST: 'https://portal.rel04.test' });
  for (const service of Object.values(services)) {
    service.pull_policy = 'never';
    service.logging = { driver: 'none' };
  }
  return {
    compose: { services, networks: { default: { internal: true } }, volumes: { database: {} } },
    blueprint: dummyUpstream(readFileSync(join(root, 'deploy/authentik/blueprints/portal-access-groups.yaml'), 'utf8')),
    disabled: Object.keys(optionalEnv),
  };
}

const readyProbe = `
from authentik.brands.models import Brand
from authentik.core.models import Group
from authentik.crypto.models import CertificateKeyPair
from authentik.events.models import NotificationTransport
from authentik.flows.models import Flow
from authentik.outposts.models import Outpost
from authentik.providers.oauth2.models import ScopeMapping
assert Brand.objects.filter(domain='authentik-default', default=True).count() == 1
assert Group.objects.filter(name='authentik Admins').count() == 1
assert CertificateKeyPair.objects.filter(name='authentik Self-signed Certificate').count() == 1
assert NotificationTransport.objects.filter(name='default-local-transport').count() == 1
for slug in ('default-authentication-flow', 'default-provider-authorization-implicit-consent', 'default-provider-invalidation-flow'):
    assert Flow.objects.filter(slug=slug).count() == 1
for scope in ('openid', 'email'):
    assert ScopeMapping.objects.filter(scope_name=scope).count() == 1
assert ScopeMapping.objects.filter(managed='goauthentik.io/providers/proxy/scope-proxy').count() == 1
assert Outpost.objects.filter(name='authentik Embedded Outpost').count() == 1
print('REL04_READY')
`;

const applyFixture = `
from pathlib import Path
from django_tenants.utils import tenant_context
from authentik.blueprints.v1.importer import Importer
from authentik.tenants.models import Tenant

tenants = list(Tenant.objects.filter(ready=True))
assert tenants
for tenant in tenants:
    with tenant_context(tenant):
        importer = Importer.from_string(Path('${blueprintPath}').read_text())
        valid, _ = importer.validate()
        assert valid
        assert importer.apply()
print('REL04_APPLIED')
`;

const ormPrelude = `
${dummyUpstream(buildOptionalProviderVerification())}
from pathlib import Path
from authentik.outposts.models import Outpost
outpost = Outpost.objects.get(name='authentik Embedded Outpost')
base = {${JSON.stringify(baseProvider)}}
scope_proxy = PortalScopeMapping.objects.get(managed='goauthentik.io/providers/proxy/scope-proxy')

def verify_base():
    provider = PortalProxyProvider.objects.get(name=${JSON.stringify(baseProvider)})
    assert PortalApplication.objects.get(slug='portal-test').provider_id == provider.pk
    assert outpost.providers.filter(pk=provider.pk).count() == 1

def identities():
    return [
        [
            str(portal_provider_model(spec).objects.get(name=spec['providerName']).pk),
            str(PortalApplication.objects.get(slug=spec['slug']).pk),
        ]
        for spec in PORTAL_OPTIONAL_PROVIDERS
    ] + [[str(outpost.pk)]]

def verify_enabled():
    verify_base()
    assert portal_verify_optional_providers(outpost, base) == ${JSON.stringify(OPTIONAL_PROVIDERS.map(({ key }) => key))}
`;

const disabledProbe = `
verify_base()
assert portal_verify_optional_providers(outpost, base) == []
for spec in PORTAL_OPTIONAL_PROVIDERS:
    assert not portal_provider_model(spec).objects.filter(name=spec['providerName']).exists()
    assert not PortalApplication.objects.filter(slug=spec['slug']).exists()
print('REL04_DISABLED')
`;

const mappingObservation = `
transmission = PortalProxyProvider.objects.get(name='Portal Transmission Protected Service Provider')
attached = transmission.property_mappings.filter(pk=scope_proxy.pk).exists()
print('REL04_SCOPE_PROXY_PRESENT' if attached else 'REL04_SCOPE_PROXY_ABSENT', flush=True)
snapshot = Path('/tmp/rel04-identities.json')
`;

const mutationProbe = `
from django.db import transaction
verify_enabled()
transmission = PortalProxyProvider.objects.get(name='Portal Transmission Protected Service Provider')
with transaction.atomic():
    transmission.property_mappings.remove(scope_proxy)
    try:
        verify_enabled()
    except AssertionError as error:
        if str(error) != ${JSON.stringify(expectedMappingFailure)}:
            raise
        print('REL04_EXPECTED_REJECTION', flush=True)
    else:
        raise AssertionError('Removed scope-proxy was accepted')
    finally:
        transmission.property_mappings.add(scope_proxy)
verify_enabled()
print('REL04_RESTORED')
`;

const markers = new Set([
  'REL04_APPLIED', 'REL04_READY', 'REL04_DISABLED', 'REL04_CREATED', 'REL04_UPDATED',
  'REL04_SCOPE_PROXY_PRESENT', 'REL04_SCOPE_PROXY_ABSENT',
  'REL04_EXPECTED_REJECTION', 'REL04_RESTORED',
]);
const composeVersion = /^v?(?:[2-9]|[1-9]\d+)\.\d+\.\d+(?:[-+][\w.+-]+)?$/;

const daemonIdentity = /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{64}|[A-Z2-7]{4}(?::[A-Z2-7]{4}){11})$/;
const imageIdentity = /^sha256:[0-9a-f]{64}$/;
const startupTimeout = 180_000;
const daemonCheck = ['info', '--format', '{{.ID}}'];
const projectLists = [
  ['container', 'ls', '--all', '--quiet'],
  ['network', 'ls', '--quiet'],
  ['volume', 'ls', '--quiet'],
];

function hasMarker(result, marker) {
  return result.output?.split(/\r?\n/).includes(marker);
}

class AcceptanceError extends Error {}

const verifierFailures = new Set([
  expectedMappingFailure,
  ...OPTIONAL_PROVIDERS.flatMap((spec) => [
    'expected exactly one provider',
    'disabled but provider still exists; remove it',
    'disabled provider still assigned to the outpost',
    'disabled application provider still assigned to the outpost',
    `disabled but application ${spec.slug} still exists; remove it`,
    `expected exactly one application ${spec.slug}`,
    'application is not bound to its provider',
    'meta_hide mismatch',
    'policy_engine_mode must be any',
    'application has no enabled policy bindings',
    'negated policy binding present',
    'user policy binding present',
    'policy-object binding present',
    'binding without group present',
    'non-scope property mapping attached',
    ...(spec.kind === 'proxy' ? [
      'internal_host mismatch',
      'external_host mismatch',
      'mode must be proxy',
      'skip_path_regex must be empty',
      'intercept_header_auth must be disabled',
      'basic auth must be enabled',
      'basic auth user attribute mismatch',
      'basic auth password attribute mismatch',
      'credential group must exist exactly once',
      'group credential username mismatch',
      'group credential password mismatch',
      'basic auth must be disabled',
      'unexpected managed property mapping',
      'duplicate managed property mapping',
      'managed scope mapping scope_name mismatch',
      'managed scope mapping expression mismatch',
      'custom property mapping scope_name mismatch',
      'unexpected property mappings',
      'provider not assigned to the embedded outpost',
      ...spec.propertyMappings.flatMap(({ name }) => [
        `missing property mapping ${name}`,
        `expected exactly one property mapping ${name}`,
        `property mapping expression mismatch for ${name}`,
      ]),
    ] : [
      'client_type must be confidential',
      'client_id mismatch',
      'client_secret does not match configuration',
      'grant_types must be authorization_code only',
      'sub_mode must be hashed_user_id',
      'issuer_mode must be per_provider',
      'redirect URIs must be exactly the configured strict URIs',
      `scopes must be exactly ${spec.scopes.join(', ')}`,
      ...spec.optionalRedirectGroups.map((group) =>
        `partially configured redirect pair ${group.map(({ env }) => env).join(', ')}`),
      ...spec.customMappings.flatMap(({ name, scopeName }) => [
        `missing scope mapping ${name}`,
        `scope mapping ${name} must use scope ${scopeName}`,
        `scope mapping expression mismatch for ${name}`,
        ...spec.forbiddenClaims.map((claim) => `scope mapping ${name} must not reference ${claim}`),
      ]),
    ]),
    `partially configured; set all or none of ${spec.conditions.join(', ')}`,
  ].map((message) => `optional provider ${spec.key}: ${message}`)),
]);

function commandFailure(stage, result, python = false, category = result.category) {
  const details = [`category=${category ?? (result.ok ? 'missing-marker' : 'transport-failure')}`];
  if (Number.isInteger(result.exitCode)) details.push(`exit=${result.exitCode}`);
  if (result.killed) details.push('killed=true');
  if (Object.hasOwn(constants.signals, result.signal)) details.push(`signal=${result.signal}`);
  if (python && result.pythonException) details.push(`python=${result.pythonException}`);
  if (python && verifierFailures.has(result.verifierFailure)) details.push(result.verifierFailure);
  return new AcceptanceError(`${stage} failed [${details.join(', ')}]`);
}

export async function runAcceptance(run, report, fixture = buildFixture()) {
  async function requireCommand(args, label, input, timeout) {
    const result = await run(args, input, timeout);
    if (!result.ok) throw commandFailure(label, result);
  }
  function shell(source, environment = [], timeout) {
    // Keep one namespace even if the installed Django shell uses separate locals.
    return run(['exec', '-T', ...environment, 'worker', 'ak', 'shell', '-c', `exec(${JSON.stringify(source)}, {})`], undefined, timeout);
  }
  const { blueprint, disabled } = fixture;
  const disabledEnv = disabled.flatMap((name) => ['-e', `${name}=`]);

  await requireCommand(['up', '--detach', '--no-build', '--pull', 'never'], 'isolated stack startup', undefined, startupTimeout);
  const deadline = Date.now() + 240_000;
  while (true) {
    const result = await shell(readyProbe);
    if (result.ok && hasMarker(result, 'REL04_READY')) break;
    if (result.category === 'spawn' || result.category === 'signal') {
      throw commandFailure('system blueprint readiness', result, true);
    }
    if (Date.now() >= deadline) {
      throw commandFailure('system blueprint readiness deadline', result, true);
    }
    await delay(3000);
  }
  report('Required system blueprint records observed in the ORM.');

  await requireCommand(
    ['exec', '-T', 'worker', 'sh', '-c', `umask 077; cat > ${blueprintPath}`],
    'fixture copy', blueprint,
  );
  const apply = async (label, environment = []) => {
    const result = await shell(applyFixture, environment, 180_000);
    if (!result.ok || !hasMarker(result, 'REL04_APPLIED')) throw commandFailure(label, result, true);
  };

  await apply('disabled fixture application', disabledEnv);
  const disabledResult = await shell(ormPrelude + disabledProbe, disabledEnv);
  if (!disabledResult.ok || !hasMarker(disabledResult, 'REL04_DISABLED')) {
    throw commandFailure('disabled ORM check', disabledResult, true);
  }
  report('All seven optional providers absent. Embedded outpost contains the base provider.');

  const failures = [];
  for (const phase of ['create', 'update']) {
    await apply(`enabled fixture ${phase}`);
    const identityCheck = phase === 'create'
      ? "snapshot.write_text(portal_json.dumps(identities()))"
      : "assert portal_json.loads(snapshot.read_text()) == identities()";
    const marker = phase === 'create' ? 'REL04_CREATED' : 'REL04_UPDATED';
    const result = await shell(ormPrelude + mappingObservation + `${identityCheck}\nverify_enabled()\nprint('${marker}')\n`);
    const mapping = ['PRESENT', 'ABSENT'].find((state) => hasMarker(result, `REL04_SCOPE_PROXY_${state}`));
    if (mapping) report(`Enabled ${phase} ORM observation: Transmission scope-proxy ${mapping.toLowerCase()}.`);
    if (result.ok && hasMarker(result, marker)) {
      report(`Enabled ${phase} ORM check passed for all seven optional providers and the embedded outpost.`);
    } else {
      failures.push(commandFailure(`${phase} ORM check`, result, true).message);
    }
  }
  if (failures.length) throw new AcceptanceError(failures.join(' | '));

  const mutation = await shell(ormPrelude + mutationProbe);
  if (!mutation.ok || !hasMarker(mutation, 'REL04_EXPECTED_REJECTION') || !hasMarker(mutation, 'REL04_RESTORED')) {
    throw commandFailure('scope-proxy removal and restoration ORM check', mutation, true);
  }
  report(`Expected verifier rejection observed (${expectedMappingFailure}). Restored mapping and ORM checks passed.`);
}

const pythonExceptionPattern = /^(?:(?:[a-zA-Z_]\w*\.)*)(AssertionError|DoesNotExist|MultipleObjectsReturned|ImportError|ModuleNotFoundError|OperationalError|ProgrammingError|IntegrityError|ValidationError|ValueError|TypeError|AttributeError|KeyError|NameError|FileNotFoundError|PermissionError|RuntimeError|SyntaxError)(?:: (.*))?$/;

export function executeDocker(args, env, input, execute = execFile, timeout = 60_000) {
  return new Promise((done) => {
    const child = execute('docker', args, { env, cwd: env.DOCKER_CONFIG, timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, output, stderr) => {
        const exitCode = Number.isInteger(error?.code) ? error.code : error ? null : 0;
        const killed = Boolean(error?.killed);
        const signal = error?.signal ?? null;
        // execFile owns the child. A killed child with a signal and no buffer error
        // was terminated by its timeout. External signals leave killed false.
        const bufferExceeded = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        const timedOut = killed && signal !== null && !bufferExceeded;
        let category;
        if (error) {
          if (bufferExceeded) category = 'output-limit';
          else if (timedOut) category = 'timeout';
          else if (signal) category = 'signal';
          else category = exitCode === null ? 'spawn' : 'exit';
        }
        const finalLine = stderr?.trimEnd().split(/\r?\n/).at(-1);
        const [, pythonException, message] = finalLine?.match(pythonExceptionPattern) ?? [];
        const outputFormat = args[2] === 'compose' && args[3] === 'version' ? composeVersion
          : args[2] === 'info' && args[4] === '{{.ID}}' ? daemonIdentity
          : args[2] === 'image' && args[3] === 'inspect' && args[5] === '{{.Id}}' ? imageIdentity
          : null;
        const projectList = projectLists.some((command) =>
          args.length === command.length + 4 && command.every((part, index) => args[index + 2] === part) &&
          args.at(-2) === '--filter' && /^label=com\.docker\.compose\.project=portal-rel04-[0-9a-f]{32}$/.test(args.at(-1)));
        // Return only whether the project inventory is empty, never resource IDs.
        const safeOutput = projectList ? (output.trim() ? 'nonempty' : 'empty') : outputFormat
          ? (outputFormat.test(output.trim()) ? output.trim() : '')
          : output.split(/\r?\n/).filter((line) => markers.has(line)).join('\n');
        done({
          ok: !error, output: safeOutput, exitCode, killed, timedOut, signal, category, pythonException,
          verifierFailure: pythonException === 'AssertionError' && verifierFailures.has(message) ? message : undefined,
        });
      });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

export async function runDisposable(transport, report, inherited = process.env, reportCleanupFailure = report) {
  const pluginDirectory = inherited.REL04_COMPOSE_PLUGIN_DIR;
  if (pluginDirectory !== undefined) {
    try {
      if (!isAbsolute(pluginDirectory) || !statSync(pluginDirectory).isDirectory()) throw new Error();
      const plugin = join(pluginDirectory, 'docker-compose');
      if (!statSync(plugin).isFile()) throw new Error();
      accessSync(plugin, fsConstants.X_OK);
    } catch {
      throw new AcceptanceError('Compose plugin configuration failed [category=invalid-plugin-directory]');
    }
  }

  const expectedDaemon = inherited.REL04_EXPECTED_DAEMON_ID;
  if (!expectedDaemon || !daemonIdentity.test(expectedDaemon)) {
    throw new AcceptanceError('Docker daemon configuration failed [category=invalid-expected-daemon-id]');
  }

  const temporaryRoot = realpathSync(tmpdir());
  const fromCheckout = relative(realpathSync(root), temporaryRoot);
  if (!isAbsolute(fromCheckout) && fromCheckout !== '..' && !fromCheckout.startsWith('..' + sep)) {
    throw new AcceptanceError('Recovery directory setup failed [category=temporary-root-in-checkout]');
  }

  const project = `portal-rel04-${randomBytes(16).toString('hex')}`;
  const directory = mkdtempSync(join(temporaryRoot, 'portal-rel04-'));
  const file = join(directory, 'compose.json');
  const envFile = join(directory, 'empty.env');
  const env = { PATH: inherited.PATH ?? '', DOCKER_CONFIG: directory, COMPOSE_DISABLE_ENV_FILE: '1' };
  const docker = (args, input, timeout) => transport(['--config', directory, ...args], env, input, timeout);
  const prefix = ['compose', '--project-directory', directory, '--env-file', envFile, '-f', file, '-p', project];
  const run = (args, input, timeout) => docker([...prefix, ...args], input, timeout);
  let attempted = false;
  let retain = false;
  let daemonFailure;
  let signal;
  const onInterrupt = () => { signal = 'SIGINT'; };
  const onTerminate = () => { signal = 'SIGTERM'; };
  const checkInterrupt = () => {
    if (signal) throw new AcceptanceError(`Interrupted by ${signal}`);
  };
  const verifyDaemon = async (stage) => {
    let result;
    try {
      result = await docker(daemonCheck);
    } catch {
      result = { ok: false };
    }
    if (result.ok && result.output === expectedDaemon) return;
    const category = !result.ok ? 'daemon-unavailable'
      : daemonIdentity.test(result.output ?? '') ? 'identity-mismatch' : 'invalid-identity';
    daemonFailure = new AcceptanceError(`${stage} failed [category=${category}]`);
    throw daemonFailure;
  };
  const runChecked = async (args, input, timeout) => {
    const action = args[0];
    await verifyDaemon(`Docker daemon before ${action}`);
    if (action !== 'down') checkInterrupt();
    if (action === 'up') attempted = true;
    try {
      return await run(args, input, timeout);
    } finally {
      await verifyDaemon(`Docker daemon after ${action}`);
    }
  };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  try {
    if (pluginDirectory !== undefined) {
      try {
        writeFileSync(join(directory, 'config.json'), JSON.stringify({ cliPluginsExtraDirs: [pluginDirectory] }),
          { mode: 0o600, flag: 'wx' });
      } catch {
        throw new AcceptanceError('Compose plugin configuration failed [category=config-write]');
      }
    }
    const fixture = buildFixture();
    writeFileSync(file, JSON.stringify(fixture.compose), { mode: 0o600 });
    writeFileSync(envFile, '', { mode: 0o600 });
    report(`Disposable project ${project}. Recovery directory ${directory}`);
    const { postgresql, server, worker } = fixture.compose.services;
    const preflight = [
      ['compose plugin/version', ['compose', 'version', '--short'], composeVersion, 'unsupported-version'],
      ['Docker daemon', daemonCheck, daemonIdentity, 'invalid-identity'],
      ['cached PostgreSQL image', ['image', 'inspect', '--format', '{{.Id}}', postgresql.image], imageIdentity, 'invalid-identity', [postgresql]],
      ['cached Authentik image', ['image', 'inspect', '--format', '{{.Id}}', server.image], imageIdentity, 'invalid-identity', [server, worker]],
    ];
    for (const [stage, args, format, category, services = []] of preflight) {
      checkInterrupt();
      const result = await docker(args);
      checkInterrupt();
      if (!result.ok) throw commandFailure(stage, result);
      if (!format.test(result.output ?? '')) throw commandFailure(stage, result, false, category);
      if (args[0] === 'info' && result.output !== expectedDaemon) {
        throw commandFailure(stage, result, false, 'identity-mismatch');
      }
      for (const service of services) service.image = result.output;
      const provenance = args[0] === 'compose' ? result.output.split(/[-+]/, 1)[0] : result.output;
      report(`${stage} verified (${provenance}).`);
    }
    writeFileSync(file, JSON.stringify(fixture.compose), { mode: 0o600 });

    await runAcceptance(async (args, input, timeout) => {
      checkInterrupt();
      const result = await runChecked(args, input, timeout);
      checkInterrupt();
      return result;
    }, report, fixture);
    report('REL-04 disposable ORM checks passed. HTTP proxy-header checks remain pending.');
  } finally {
    try {
      if (attempted) {
        retain = true;
        try {
          if (daemonFailure) throw daemonFailure;
          const result = await runChecked(['down', '--volumes', '--timeout', '10']);
          if (!result.ok) throw commandFailure('Project cleanup down', result);
          for (const args of projectLists) {
            const stage = `Project cleanup ${args[0]} inventory`;
            const inventory = await docker([...args, '--filter', `label=com.docker.compose.project=${project}`]);
            if (!inventory.ok) throw commandFailure(stage, inventory);
            if (inventory.output !== 'empty') {
              const category = inventory.output === 'nonempty' ? 'resources-remain' : 'invalid-inventory';
              throw commandFailure(stage, inventory, false, category);
            }
          }
          await verifyDaemon('Docker daemon after resource inventory');
          retain = false;
        } catch (error) {
          const diagnostic = error instanceof AcceptanceError ? error.message : 'Project cleanup failed [category=transport-failure]';
          reportCleanupFailure(`Project cleanup unverified for ${project}. Recovery directory ${directory}. ${diagnostic}`);
          process.exitCode = 1;
        }
        if (!retain) report(`Removed disposable resources for ${project}.`);
      }
      if (!retain) rmSync(directory, { recursive: true, force: true });
    } finally {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      if (signal) process.exitCode = signal === 'SIGINT' ? 130 : 143;
    }
  }
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--confirm-disposable-rel04') {
    throw new AcceptanceError('Explicit opt-in required. Use --confirm-disposable-rel04.');
  }
  await runDisposable(
    (args, env, input, timeout) => executeDocker(args, env, input, execFile, timeout),
    console.log, process.env, console.error,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof AcceptanceError ? error.message : 'REL-04 harness failed.');
    process.exitCode ||= 1;
  });
}
