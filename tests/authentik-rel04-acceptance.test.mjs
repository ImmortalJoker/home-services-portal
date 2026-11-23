import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { OPTIONAL_PROVIDERS } from '../scripts/authentik-runtime-optional-providers.mjs';
import * as harness from '../scripts/authentik-rel04-acceptance.mjs';
const { buildFixture, runAcceptance } = harness;
const daemonId = '01234567-89ab-cdef-0123-456789abcdef';
const imageIds = ['sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64)];
const dummySecret = 'https://rel04-private-user:dummy-secret@rel04-private-host.test/';

function assertRedacted(value) {
  for (const sentinel of [dummySecret, 'rel04-private-user', 'dummy-secret', 'rel04-private-host.test']) {
    assert.ok(!value.includes(sentinel));
  }
}

test('CI runs both verifier suites without opting into the Docker acceptance stack', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const command = pkg.scripts['test:authentik-verifier'];
  assert.ok(command, 'the verifier suites need an explicit npm command');
  assert.ok(command.includes('tests/authentik-runtime-optional-providers.test.mjs'));
  assert.ok(command.includes('tests/authentik-rel04-acceptance.test.mjs'));
  const workflow = parseYaml(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  const commands = workflow.jobs.verify.steps.map((step) => step.run ?? '');
  assert.ok(commands.some((run) => run.trim() === 'npm run test:authentik-verifier'));
  assert.ok(commands.every((run) => !run.includes('--confirm-disposable-rel04')),
    'real Authentik acceptance must remain an explicit operator opt-in');
});

test('fixture uses pinned images, an internal network and only project volumes', () => {
  const { compose, blueprint, disabled } = buildFixture();
  const pinned = readFileSync(new URL('../deploy/authentik/compose.yml', import.meta.url), 'utf8')
    .match(/image: (ghcr\.io\/goauthentik\/server:[^\s]+)/)[1];
  assert.equal(compose.services.server.image, pinned);
  assert.equal(compose.services.worker.image, pinned);
  assert.equal(compose.services.postgresql.image, 'docker.io/library/postgres:16-alpine');
  assert.deepEqual(compose.services.postgresql.healthcheck.test.slice(0, 4),
    ['CMD', 'pg_isready', '-h', '127.0.0.1']);
  assert.deepEqual(compose.networks, { default: { internal: true } });
  for (const service of Object.values(compose.services)) {
    assert.equal(service.logging.driver, 'none');
    for (const key of ['ports', 'network_mode', 'privileged', 'extra_hosts', 'container_name', 'env_file']) {
      assert.equal(Object.hasOwn(service, key), false, key);
    }
    for (const mount of service.volumes ?? []) {
      assert.equal(mount.type, 'volume');
      assert.ok(Object.hasOwn(compose.volumes, mount.source));
    }
  }
  for (const spec of OPTIONAL_PROVIDERS) {
    for (const key of spec.conditions) {
      assert.ok(compose.services.worker.environment[key], key);
      assert.ok(disabled.includes(key), key);
    }
  }
  assert.doesNotMatch(blueprint, /host\.docker\.internal/);
});

test('an initial ORM failure still permits the update observation and preserves failure', async () => {
  const commands = [];
  const reports = [];
  await assert.rejects(runAcceptance(async (args, input) => {
    commands.push({ args, input });
    if (args.at(-1).includes('REL04_APPLIED')) return { ok: true, output: 'REL04_APPLIED' };
    if (args.includes('shell')) {
      if (args.at(-1).includes('REL04_CREATED')) return { ok: true, output: 'REL04_SCOPE_PROXY_ABSENT\n' };
      return { ok: true, output: 'REL04_READY\nREL04_DISABLED\nREL04_SCOPE_PROXY_PRESENT\nREL04_UPDATED\n' };
    }
    return { ok: true };
  }, (message) => reports.push(message)), /create ORM check failed/);
  assert.equal(commands.filter(({ args }) => args.at(-1).includes('REL04_APPLIED')).length, 3);
  assert.ok(reports.some((message) => message.includes('create') && message.includes('absent')));
  assert.ok(reports.some((message) => message.includes('update') && message.includes('present')));
  assert.equal(commands.some(({ args }) => args.at(-1).includes('REL04_RESTORED')), false);
});

test('disabled commands clear the fixture settings and mutation requires both ORM markers', async () => {
  for (const mutationOutput of ['REL04_RESTORED\n', 'REL04_EXPECTED_REJECTION\nREL04_RESTORED\n']) {
    const commands = [];
    const acceptance = runAcceptance(async (args) => {
      commands.push(args);
      if (!args.includes('shell')) return { ok: true };
      const marker = ['REL04_APPLIED', 'REL04_READY', 'REL04_DISABLED', 'REL04_CREATED', 'REL04_UPDATED']
        .find((candidate) => args.at(-1).includes(candidate));
      return { ok: true, output: marker ? `${marker}\n` : mutationOutput };
    }, () => {});
    if (mutationOutput.startsWith('REL04_RESTORED')) {
      await assert.rejects(acceptance, /removal and restoration ORM check failed/);
    } else {
      await acceptance;
    }
    const applies = commands.filter((args) => args.at(-1).includes('REL04_APPLIED'));
    assert.equal(applies.length, 3);
    const { disabled } = buildFixture();
    const workerShell = ['worker', 'ak', 'shell', '-c', applies[0].at(-1)];
    assert.deepEqual(applies[0], ['exec', '-T', ...disabled.flatMap((name) => ['-e', `${name}=`]), ...workerShell]);
    assert.deepEqual(applies.slice(1), [['exec', '-T', ...workerShell], ['exec', '-T', ...workerShell]]);
    assert.deepEqual(commands[commands.indexOf(applies[0]) - 1],
      ['exec', '-T', 'worker', 'sh', '-c', 'umask 077; cat > /tmp/rel04-portal-fixture.yaml']);
    assert.ok(commands.find((args) => args.at(-1).includes('REL04_DISABLED'))
      .includes('PORTAL_TRANSMISSION_EXTERNAL_HOST='));
  }
});


test('blueprint imports retain a bounded 180-second budget during create and reapply', async () => {
  const calls = [];
  await runAcceptance(async (args, input, timeout) => {
    calls.push({ args, timeout });
    if (!args.includes('shell')) return { ok: true };
    const marker = ['REL04_APPLIED', 'REL04_READY', 'REL04_DISABLED', 'REL04_CREATED', 'REL04_UPDATED']
      .find((value) => args.at(-1).includes(value));
    return { ok: true, output: marker ? marker + '\n' : 'REL04_EXPECTED_REJECTION\nREL04_RESTORED\n' };
  }, () => {});
  const imports = calls.filter(({ args }) => args.at(-1).includes('REL04_APPLIED'));
  assert.equal(imports.length, 3);
  for (const call of imports) assert.equal(call.timeout, 180_000);
  for (const call of calls.filter(({ args }) => args.includes('shell') && !args.at(-1).includes('REL04_APPLIED'))) {
    assert.equal(call.timeout, undefined, 'read-only probes must retain their shorter transport default');
  }
});

test('generated ORM commands contain valid Python for every phase', async () => {
  const sources = [];
  await runAcceptance(async (args) => {
    if (!args.includes('shell')) return { ok: true };
    const source = args.at(-1);
    sources.push(source);
    const marker = ['REL04_APPLIED', 'REL04_READY', 'REL04_DISABLED', 'REL04_CREATED', 'REL04_UPDATED']
      .find((candidate) => source.includes(candidate));
    return { ok: true, output: marker ? `${marker}\n` : 'REL04_EXPECTED_REJECTION\nREL04_RESTORED\n' };
  }, () => {});
  assert.equal(sources.length, 8);
  for (const source of sources.filter((source) => source.includes('REL04_APPLIED'))) {
    assert.match(source, /Tenant.objects.filter\(ready=True\)/);
    assert.match(source, /with tenant_context\(tenant\)/);
    assert.ok(source.includes("Importer.from_string(Path('/tmp/rel04-portal-fixture.yaml').read_text())"));
    assert.ok(source.includes('valid, _ = importer.validate()'));
    assert.ok(source.includes('assert valid'));
    assert.ok(source.includes('assert importer.apply()'));
    assert.doesNotMatch(source, /BlueprintInstance|apply_blueprint/);
  }
  const result = spawnSync('python3', ['-c', [
    'import ast, json, sys',
    'for command in json.load(sys.stdin):',
    '    inner = ast.literal_eval(ast.parse(command).body[0].value.args[0])',
    '    compile(inner, "<rel04 ORM probe>", "exec")',
  ].join('\n')], { input: JSON.stringify(sources), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('Docker transport preserves exit, timeout and signal without returning stderr', async () => {
  const cases = [
    [{ code: 17, killed: false, signal: null }, { exitCode: 17, killed: false, timedOut: false, signal: null }],
    [{ code: null, killed: true, signal: 'SIGTERM' }, { exitCode: null, killed: true, timedOut: true, signal: 'SIGTERM' }],
    [{ code: null, killed: false, signal: 'SIGKILL' }, { exitCode: null, killed: false, timedOut: false, signal: 'SIGKILL' }],
    [{ code: 'ENOENT', killed: false, signal: null }, { exitCode: null, killed: false, timedOut: false, signal: null }],
  ];
  for (const [error, expected] of cases) {
    const result = await harness.executeDocker([], {}, undefined, (file, args, options, callback) => {
      queueMicrotask(() => callback(error, dummySecret, 'ValueError: ' + dummySecret + '\n'));
      return {};
    });
    assert.equal(result.ok, false);
    for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value);
    assert.equal(result.pythonException, 'ValueError');
    assert.equal(result.verifierFailure, undefined);
    assertRedacted(JSON.stringify(result));
  }
});

test('ORM failure reports only safe transport metadata and exact allowlisted assertions', async () => {
  const allowed = 'optional provider transmission: missing required managed proxy mapping for upstream basic auth';
  const added = 'optional provider transmission: internal_host mismatch';
  const reports = [];
  const acceptance = runAcceptance(async (args) => {
    if (!args.includes('shell')) return { ok: true };
    const source = args.at(-1);
    if (source.includes('REL04_CREATED') || source.includes('REL04_UPDATED')) {
      const stderr = source.includes('REL04_CREATED')
        ? 'AssertionError: ' + added
        : 'AssertionError: ' + allowed + '\n\nThe above exception was the direct cause of the following exception:\n\nTraceback (most recent call last):\nRuntimeError: ' + dummySecret;
      return harness.executeDocker(args, {}, undefined, (file, argv, options, callback) => {
        queueMicrotask(() => callback({ code: 23, killed: false }, dummySecret, stderr));
        return {};
      });
    }
    return { ok: true, output: 'REL04_READY\nREL04_DISABLED\nREL04_APPLIED\n' };
  }, (message) => reports.push(message));
  await assert.rejects(acceptance, (error) => {
    reports.push(error.message);
    return /create ORM check failed/.test(error.message);
  });
  const [create, update] = reports.at(-1).split(' | ');
  assert.ok(create.includes(added));
  assert.ok(update.includes('RuntimeError'));
  assert.match(update, /exit=23/);
  assert.doesNotMatch(update, /missing required/);
  assertRedacted(reports.join('\n'));
});

test('preflight uses one sanitized configuration and stops before up for each missing prerequisite', async () => {
  const preflight = [
    ['compose', 'version', '--short'],
    ['info', '--format', '{{.ID}}'],
    ['image', 'inspect', '--format', '{{.Id}}', 'docker.io/library/postgres:16-alpine'],
    ['image', 'inspect', '--format', '{{.Id}}', 'ghcr.io/goauthentik/server:2026.8.5'],
  ];
  const stages = ['compose plugin/version', 'Docker daemon', 'cached PostgreSQL image', 'cached Authentik image'];
  for (const failure of ['version', 'daemon', 'image', 0, 1, 2, 3, 4]) {
    const commands = [];
    const reports = [];
    const cachedTags = new Map(preflight.slice(2).map((args, index) => [args.at(-1), imageIds[index]]));
    let recovery;
    const transport = async (args, env, input, timeout) => {
      const index = commands.push(args) - 1;
      recovery ??= args[1];
      assert.equal(args[0], '--config');
      assert.equal(args[1], recovery);
      assert.deepEqual(env, { PATH: '/fake', DOCKER_CONFIG: recovery, COMPOSE_DISABLE_ENV_FILE: '1' });
      assert.equal(dirname(recovery), realpathSync(tmpdir()));
      assert.ok(relative(import.meta.dirname + '/..', recovery).startsWith('..'));
      assert.equal(statSync(recovery).mode & 0o777, 0o700);
      assert.equal(existsSync(join(recovery, 'config.json')), false);
      for (const file of ['compose.json', 'empty.env']) {
        assert.equal(statSync(join(recovery, file)).mode & 0o777, 0o600);
      }
      if (index < 4) {
        assert.deepEqual(args.slice(2), preflight[index]);
        return {
          ok: index !== failure,
          output: [failure === 'version' ? '1.29.2' : '2.39.0',
            failure === 'daemon' ? 'fedcba98-7654-3210-fedc-ba9876543210' : daemonId,
            failure === 'image' ? dummySecret : cachedTags.get(args.at(-1)),
            cachedTags.get(args.at(-1))][index],
        };
      }
      if (args[2] === 'info') {
        assert.deepEqual(args.slice(2), daemonCheck);
        return { ok: true, output: daemonId };
      }
      if (args[2] !== 'compose') {
        const list = projectLists.find(([kind]) => kind === args[2]);
        const up = commands.find((command) => command.includes('up'));
        assert.deepEqual(args.slice(2), [...list, '--filter', `label=com.docker.compose.project=${up[up.indexOf('-p') + 1]}`]);
        return { ok: true, output: 'empty' };
      }
      assert.ok(args.includes('--env-file'));
      if (args.includes('up')) {
        assert.equal(timeout, 180_000);
        assert.deepEqual(args.slice(-5), ['up', '--detach', '--no-build', '--pull', 'never']);
        const replacementId = 'sha256:' + 'c'.repeat(64);
        for (const tag of cachedTags.keys()) cachedTags.set(tag, replacementId);
        const { services } = JSON.parse(readFileSync(args[args.indexOf('-f') + 1], 'utf8'));
        for (const [service, verifiedId] of [
          ['postgresql', imageIds[0]], ['server', imageIds[1]], ['worker', imageIds[1]],
        ]) {
          const image = services[service].image;
          assert.equal(cachedTags.get(image) ?? image, verifiedId, `${service} must use the inspected image at up`);
          assert.equal(image, verifiedId);
        }
        return { ok: false, exitCode: 5 };
      }
      assert.equal(timeout, undefined);
      assert.deepEqual(args.slice(-4), ['down', '--volumes', '--timeout', '10']);
      return { ok: true };
    };
    await assert.rejects(harness.runDisposable(transport, (message) => reports.push(message), {
      REL04_EXPECTED_DAEMON_ID: daemonId, PATH: '/fake', DOCKER_HOST: 'inherited', DOCKER_CONFIG: 'inherited', DOCKER_CONTEXT: 'inherited',
      HOME: 'inherited', COMPOSE_ENV_FILES: 'inherited',
    }), (error) => error.message.includes(failure === 'version'
      ? 'category=unsupported-version' : failure === 'daemon' ? 'category=identity-mismatch'
        : failure === 'image' ? 'category=invalid-identity' : stages[failure] ?? 'isolated stack startup'));
    if (failure === 4) {
      assert.deepEqual(commands.slice(preflight.length).map((args) =>
        args[2] === 'compose' ? args[args.indexOf('-p') + 2] : args[2]),
      ['info', 'up', 'info', 'info', 'down', 'info', 'container', 'network', 'volume', 'info']);
    } else {
      assert.equal(commands.length, ({ version: 1, daemon: 2, image: 3 })[failure] ?? failure + 1);
    }
    assert.equal(existsSync(recovery), false);
    assertRedacted(reports.join('\n'));
    if (failure === 4) {
      assert.ok(reports.some((message) => message.includes(daemonId)));
      for (const imageId of imageIds) assert.ok(reports.some((message) => message.includes(imageId)));
    }
  }
});

const daemonCheck = ['info', '--format', '{{.ID}}'];
const projectLists = [
  ['container', 'ls', '--all', '--quiet'],
  ['network', 'ls', '--quiet'],
  ['volume', 'ls', '--quiet'],
];
const otherDaemonId = 'fedcba98-7654-3210-fedc-ba9876543210';

for (const [fault, expectedCommands, diagnostic, retained] of [
  ['before-up', [], /before up.*identity-mismatch/, false],
  ['after-up', ['up'], /after up.*identity-mismatch/, true],
  ['before-exec', ['up'], /before exec.*daemon-unavailable/, true],
  ['before-down', ['up'], /before down.*identity-mismatch/, true],
  ['after-down', ['up', 'down'], /after down.*identity-mismatch/, true],
  ['down-failure', ['up', 'down'], /down.*exit/, true],
  ['remaining-container', ['up', 'down'], /container.*resources-remain/, true],
  ['remaining-network', ['up', 'down'], /network.*resources-remain/, true],
  ['remaining-volume', ['up', 'down'], /volume.*resources-remain/, true],
  ['list-failure', ['up', 'down'], /container.*exit/, true],
  ['after-inventory', ['up', 'down'], /after resource inventory.*identity-mismatch/, true],
  ['verified', ['up', 'down'], null, false],
]) {
  test(`daemon lifecycle handles ${fault}`, async () => {
    const commands = [];
    const reports = [];
    const exitCode = process.exitCode;
    let recovery;
    let project;
    let checks = 0;
    let lists = 0;
    try {
      await assert.rejects(harness.runDisposable(async (argv, env) => {
        recovery ??= argv[1];
        assert.deepEqual(argv.slice(0, 2), ['--config', recovery]);
        assert.deepEqual(env, { PATH: '/fake', DOCKER_CONFIG: recovery, COMPOSE_DISABLE_ENV_FILE: '1' });
        const args = argv.slice(2);
        if (args[0] === 'info') {
          assert.deepEqual(args, daemonCheck);
          checks += 1;
          if (fault === 'before-exec' && checks === 4) return { ok: false, output: dummySecret };
          const mismatchAt = { 'before-up': 2, 'after-up': 3, 'before-down': 4, 'after-down': 5, 'after-inventory': 6 };
          return { ok: true, output: checks === mismatchAt[fault] ? otherDaemonId : daemonId };
        }
        if (args[0] === 'image') return { ok: true, output: imageIds[0] };
        if (args[1] === 'version') return { ok: true, output: '2.39.0' };
        if (args[0] === 'compose') {
          project = args[args.indexOf('-p') + 1];
          const action = args[args.indexOf('-p') + 2];
          commands.push(action);
          if (action === 'up') return { ok: fault === 'before-exec', exitCode: 5 };
          assert.equal(action, 'down');
          return fault === 'down-failure' ? { ok: false, category: 'exit', output: dummySecret } : { ok: true };
        }
        assert.deepEqual(args, [...projectLists[lists++], '--filter', `label=com.docker.compose.project=${project}`]);
        if (fault === 'list-failure') return { ok: false, category: 'exit', output: dummySecret };
        return { ok: true, output: fault === `remaining-${args[0]}` ? 'nonempty' : 'empty' };
      }, (message) => reports.push(message), { REL04_EXPECTED_DAEMON_ID: daemonId, PATH: '/fake' }),
      (error) => {
        reports.push(error.message);
        return /isolated stack startup|Docker daemon/.test(error.message);
      });
      assert.deepEqual(commands, expectedCommands);
      assert.equal(existsSync(recovery), retained);
      assert.equal(reports.some((message) => message.includes('Removed disposable resources')), fault === 'verified');
      const diagnostics = reports.join('\n');
      if (diagnostic) assert.match(diagnostics, diagnostic);
      assert.equal(diagnostics.includes('cleanup unverified'), retained);
      if (retained) {
        assert.ok(diagnostics.includes(recovery));
        assert.ok(diagnostics.includes(project));
        assert.equal(statSync(recovery).mode & 0o777, 0o700);
        for (const file of ['compose.json', 'empty.env']) {
          assert.equal(statSync(join(recovery, file)).mode & 0o777, 0o600);
        }
      }
      assertRedacted(diagnostics);
      assert.ok(!diagnostics.includes(otherDaemonId));
      if (fault === 'after-down' || fault === 'down-failure') {
        assert.equal(checks, 5);
        assert.equal(lists, 0);
      }
      if (fault === 'verified') {
        assert.equal(checks, 6);
        assert.equal(lists, 3);
      }
    } finally {
      process.exitCode = exitCode;
      if (recovery) rmSync(recovery, { recursive: true, force: true });
    }
  });
}

test('explicit Compose plugin discovery writes only the selected directory into private disposable config', async (t) => {
  const pluginDir = mkdtempSync(join(realpathSync(tmpdir()), 'rel04-private plugin-'));
  t.after(() => rmSync(pluginDir, { recursive: true, force: true }));
  writeFileSync(join(pluginDir, 'docker-compose'), '#!/bin/sh\nexit 99\n', { mode: 0o700 });
  const reports = [];
  let recovery;
  await assert.rejects(harness.runDisposable(async (args, env) => {
    assert.deepEqual(args.slice(2), ['compose', 'version', '--short']);
    recovery = args[1];
    assert.deepEqual(env, { PATH: '/fake', DOCKER_CONFIG: recovery, COMPOSE_DISABLE_ENV_FILE: '1' });
    assert.equal(dirname(recovery), realpathSync(tmpdir()));
    assert.notEqual(recovery, pluginDir);
    assert.equal(statSync(recovery).mode & 0o777, 0o700);
    const config = join(recovery, 'config.json');
    assert.equal(statSync(config).mode & 0o777, 0o600);
    assert.equal(readFileSync(config, 'utf8'), JSON.stringify({ cliPluginsExtraDirs: [pluginDir] }));
    return { ok: false, exitCode: 1 };
  }, (message) => reports.push(message), {
    REL04_EXPECTED_DAEMON_ID: daemonId, PATH: '/fake', REL04_COMPOSE_PLUGIN_DIR: pluginDir,
    DOCKER_CONFIG: pluginDir, HOME: pluginDir, DOCKER_HOST: 'private-host',
  }), (error) => {
    reports.push(error.message);
    return error.message.includes('compose plugin/version failed');
  });
  assert.ok(reports.every((message) => !message.includes(pluginDir) && !message.includes('private-host')));
  assert.equal(existsSync(recovery), false);
  assert.ok(existsSync(join(pluginDir, 'docker-compose')));
  assert.equal(existsSync(join(pluginDir, 'config.json')), false);
});

test('invalid explicit Compose plugin directories fail at config setup before any Docker call', async (t) => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'rel04-private-invalid-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const nonExecutable = join(directory, 'docker-compose');
  writeFileSync(nonExecutable, '', { mode: 0o600 });
  const directoryWithFakePlugin = join(directory, 'fake');
  mkdirSync(join(directoryWithFakePlugin, 'docker-compose'), { recursive: true });
  for (const path of ['', 'private-relative', join(directory, 'missing'), nonExecutable, directory, directoryWithFakePlugin]) {
    const reports = [];
    await assert.rejects(harness.runDisposable(async () => {
      assert.fail('invalid configuration reached Docker transport');
    }, (message) => reports.push(message), { REL04_COMPOSE_PLUGIN_DIR: path }), {
      message: 'Compose plugin configuration failed [category=invalid-plugin-directory]',
    });
    assert.deepEqual(reports, []);
  }
});

test('missing or malformed expected daemon ID prevents Docker calls', async () => {
  for (const expected of [undefined, '', dummySecret]) {
    await assert.rejects(harness.runDisposable(async () => {
      assert.fail('unapproved daemon configuration reached Docker transport');
    }, () => {}, { REL04_EXPECTED_DAEMON_ID: expected }), /invalid-expected-daemon-id/);
  }
});

test('Docker transport propagates startup timeout and filters preflight identities', async () => {
  for (const [args, output, expected, timeout] of [
    [['compose', 'up'], dummySecret, '', 180_000],
    [['compose', 'down'], dummySecret, '', undefined],
    ...projectLists.flatMap((args) => {
      const query = [...args, '--filter', `label=com.docker.compose.project=portal-rel04-${'a'.repeat(32)}`];
      return [[query, '', 'empty', undefined], [query, dummySecret, 'nonempty', undefined]];
    }),
    [['info', '--format', '{{.ID}}'], daemonId + '\n', daemonId, undefined],
    [['image', 'inspect', '--format', '{{.Id}}', 'cached'], imageIds[0] + '\n', imageIds[0], undefined],
    [['info', '--format', '{{.ID}}'], daemonId + '\n' + dummySecret, '', undefined],
    [['image', 'inspect', '--format', '{{.Id}}', 'cached'], dummySecret, '', undefined],
  ]) {
    const result = await harness.executeDocker(['--config', '/fake', ...args], {}, undefined,
      (file, argv, options, callback) => {
        assert.equal(options.timeout, timeout ?? 60_000);
        queueMicrotask(() => callback(null, output, ''));
        return {};
      }, timeout);
    assert.equal(result.output, expected);
    assertRedacted(JSON.stringify(result));
  }
});
