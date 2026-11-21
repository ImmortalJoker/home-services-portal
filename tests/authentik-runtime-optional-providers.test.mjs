// Executes the generated optional-provider runtime verifier against an
// in-memory Authentik ORM fake (tests/helpers/fake_authentik_orm.py). No live
// stack, no network, no third-party test dependency.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { isMap, isScalar, isSeq, parseDocument, YAMLSeq } from 'yaml';
import {
  OPTIONAL_PROVIDERS,
  PORTAL_GROUP_NAMES,
  buildOptionalProviderVerification,
  normalizeExpression,
} from '../scripts/authentik-runtime-optional-providers.mjs';

const helper = resolve(import.meta.dirname, 'helpers/fake_authentik_orm.py');
const code = buildOptionalProviderVerification();
const BASE_PROVIDER = 'Portal Test Protected Service Provider';
const ALL_KEYS = OPTIONAL_PROVIDERS.map((spec) => spec.key);
const spec = (key) => OPTIONAL_PROVIDERS.find((entry) => entry.key === key);

// Every configured value carries a sentinel so any echo in output is detectable.
const ENV = {
  PORTAL_BOOKS_EXTERNAL_HOST: 'https://books.sentinel-host.test',
  PORTAL_AUDIOBOOKSHELF_EXTERNAL_HOST: 'https://abs.sentinel-host.test',
  PORTAL_METRICS_EXTERNAL_HOST: 'https://metrics.sentinel-host.test',
  PORTAL_TRANSMISSION_EXTERNAL_HOST: 'https://transmission.sentinel-host.test',
  PORTAL_TRANSMISSION_RPC_USERNAME: 'sentinel-rpc-user-91c2',
  PORTAL_TRANSMISSION_RPC_PASSWORD: 'sentinel-rpc-password-5d0e',
  PORTAL_GROCY_EXTERNAL_HOST: 'https://grocy.sentinel-host.test',
  PORTAL_GROCY_INTERNAL_HOST: 'http://sentinel-grocy-upstream.test:9283',
  PORTAL_AUDIOBOOKSHELF_OIDC_CLIENT_SECRET: 'sentinel-abs-oidc-secret-3a7f',
  PORTAL_AUDIOBOOKSHELF_OIDC_WEB_CALLBACK_URL: 'https://abs.sentinel-host.test/auth/openid/callback',
  PORTAL_AUDIOBOOKSHELF_OIDC_MOBILE_CALLBACK_URL: 'https://abs.sentinel-host.test/auth/openid/mobile-redirect',
  PORTAL_AUDIOBOOKSHELF_OIDC_LOGOUT_CALLBACK_URL: 'https://abs.sentinel-host.test/logout',
  PORTAL_IMMICH_OIDC_CLIENT_SECRET: 'sentinel-immich-oidc-secret-b84c',
  PORTAL_IMMICH_OIDC_WEB_LOGIN_CALLBACK_URL: 'https://photos.sentinel-host.test/auth/login',
  PORTAL_IMMICH_OIDC_WEB_LINK_CALLBACK_URL: 'https://photos.sentinel-host.test/user-settings',
  PORTAL_IMMICH_OIDC_LAN_LOGIN_CALLBACK_URL: 'http://photos.sentinel-lan.test/auth/login',
  PORTAL_IMMICH_OIDC_LAN_LINK_CALLBACK_URL: 'http://photos.sentinel-lan.test/user-settings',
  PORTAL_IMMICH_OIDC_MOBILE_CALLBACK_URL: 'app.immich:///oauth-callback-sentinel',
};
const IMMICH_HTTPS_PAIR = {
  PORTAL_IMMICH_OIDC_HTTPS_LOGIN_CALLBACK_URL: 'https://photos.sentinel-https.test/auth/login',
  PORTAL_IMMICH_OIDC_HTTPS_LINK_CALLBACK_URL: 'https://photos.sentinel-https.test/user-settings',
};
const IMMICH_TAILNET_PAIR = {
  PORTAL_IMMICH_OIDC_TAILNET_LOGIN_CALLBACK_URL: 'https://photos.sentinel-tailnet.test/auth/login',
  PORTAL_IMMICH_OIDC_TAILNET_LINK_CALLBACK_URL: 'https://photos.sentinel-tailnet.test/user-settings',
};
// Values that exist only in the fake database (drifted state) must not leak either.
const DRIFTED_SECRET = 'sentinel-drifted-db-secret-ee41';

function envFor(keys, extra = {}) {
  const env = {};
  for (const key of keys) {
    const entry = spec(key);
    for (const name of [...entry.conditions, ...entry.requiredWhenEnabled]) env[name] = ENV[name];
  }
  return { ...env, ...extra };
}

// Builds a world that matches the blueprint for `env`. Disabled optional
// providers are absent unless `lingering` lists their keys.
function buildWorld(env, { lingering = [] } = {}) {
  const enabled = (entry) => entry.conditions.every((name) => env[name]);
  const world = {
    scopeMappings: [
      { pk: 'scope-openid', name: "authentik default OAuth Mapping: OpenID 'openid'", scope_name: 'openid' },
      { pk: 'scope-email', name: "authentik default OAuth Mapping: OpenID 'email'", scope_name: 'email' },
      { pk: 'scope-abs-profile', name: 'Portal Audiobookshelf OIDC Profile', scope_name: 'profile', expression: customMapping('audiobookshelf-oidc').expression },
      { pk: 'scope-immich-profile', name: 'Portal Immich Profile (No Email)', scope_name: 'profile', expression: customMapping('immich-oidc').expression },
    ],
    propertyMappings: [
      { pk: 'map-metrics-host', name: 'Portal Metrics Host Header', expression: spec('metrics').propertyMappings[0].expression },
      { pk: 'map-transmission-host', name: 'Portal Transmission Host Header', expression: spec('transmission').propertyMappings[0].expression },
    ],
    groups: PORTAL_GROUP_NAMES.map((name) => ({ name, attributes: {} })),
    proxyProviders: [proxyRecord(BASE_PROVIDER, 'base', { internal_host: 'http://host.docker.internal:8080' })],
    oauth2Providers: [],
    applications: [],
    bindings: [],
    outpostProviders: ['base'],
  };
  for (const entry of OPTIONAL_PROVIDERS) {
    const on = enabled(entry);
    if (!on && !lingering.includes(entry.key)) continue;
    const pk = `provider-${entry.key}`;
    if (entry.kind === 'proxy') {
      world.proxyProviders.push(proxyRecord(entry.providerName, pk, {
        internal_host: 'literal' in entry.internalHost ? entry.internalHost.literal : env[entry.internalHost.env] ?? '',
        external_host: env[entry.externalHostEnv] ?? '',
        basic_auth_enabled: Boolean(entry.basicAuth),
        basic_auth_user_attribute: entry.basicAuth?.userAttribute ?? '',
        basic_auth_password_attribute: entry.basicAuth?.passwordAttribute ?? '',
        property_mappings: entry.propertyMappings.map((mapping) =>
          world.propertyMappings.find((candidate) => candidate.name === mapping.name).pk),
      }));
      if (on) world.outpostProviders.push(pk);
      if (on && entry.basicAuth) {
        const owner = world.groups.find((group) => group.name === entry.basicAuth.group);
        owner.attributes[entry.basicAuth.userAttribute] = env[entry.basicAuth.userEnv];
        owner.attributes[entry.basicAuth.passwordAttribute] = env[entry.basicAuth.passwordEnv];
      }
    } else {
      const uris = [...entry.redirectUris, ...entry.optionalRedirectGroups.filter((pair) => pair.every((uri) => env[uri.env])).flat()];
      world.oauth2Providers.push({
        pk,
        name: entry.providerName,
        client_type: 'confidential',
        client_id: entry.clientId,
        client_secret: env[entry.clientSecretEnv] ?? DRIFTED_SECRET,
        grant_types: ['authorization_code'],
        sub_mode: 'hashed_user_id',
        issuer_mode: 'per_provider',
        redirect_uris: uris.map((uri) => ({ matching_mode: uri.matchingMode, url: env[uri.env] ?? 'https://stale.sentinel.test', redirect_uri_type: uri.type })),
        property_mappings: world.scopeMappings
          .filter((mapping) => entry.scopes.includes(mapping.scope_name))
          .filter((mapping) => mapping.scope_name !== 'profile' || entry.customMappings.some((custom) => custom.name === mapping.name))
          .map((mapping) => mapping.pk),
      });
    }
    const appPk = `app-${entry.key}`;
    world.applications.push({ pk: appPk, slug: entry.slug, provider: pk, meta_hide: entry.metaHide, policy_engine_mode: 'any' });
    entry.bindings.forEach((group, order) => world.bindings.push({ target: appPk, order, group, enabled: true, negate: false }));
  }
  return world;
}

function customMapping(key) {
  return spec(key).customMappings[0];
}

function proxyRecord(name, pk, fields) {
  return {
    pk,
    name,
    internal_host: '',
    external_host: '',
    mode: 'proxy',
    skip_path_regex: '',
    intercept_header_auth: false,
    basic_auth_enabled: false,
    basic_auth_user_attribute: '',
    basic_auth_password_attribute: '',
    property_mappings: [],
    ...fields,
  };
}

function runVerifier(env, world) {
  const result = spawnSync('python3', ['-I', helper], {
    input: JSON.stringify({ code, world, base: [BASE_PROVIDER] }),
    // Only synthetic values: nothing inherited from the caller's environment.
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  const output = `${result.stdout}${result.stderr}`;
  // Fail-closed checks must name providers/fields, never configured or stored values.
  assert.doesNotMatch(output, /sentinel/, `verifier output leaked a configured value:\n${output}`);
  assert.ok(result.status === 0 || result.status === 1, `unexpected exit ${result.status}:\n${output}`);
  return { ok: result.status === 0, output: output.trim() };
}

function expectOk(env, world, keys) {
  const { ok, output } = runVerifier(env, world);
  assert.ok(ok, output);
  assert.deepEqual(JSON.parse(output.replace(/^OK /, '')), keys);
}

function expectFail(env, world, pattern) {
  const { ok, output } = runVerifier(env, world);
  assert.ok(!ok, `expected failure matching ${pattern}, got: ${output}`);
  assert.match(output, /^FAIL: /);
  assert.match(output, pattern);
}

const providerOf = (world, key) =>
  [...world.proxyProviders, ...world.oauth2Providers].find((provider) => provider.pk === `provider-${key}`);

test('spec covers every optional provider and slug defined in the blueprint', () => {
  const blueprint = readFileSync(resolve(import.meta.dirname, '../deploy/authentik/blueprints/portal-access-groups.yaml'), 'utf8');
  const names = [...blueprint.matchAll(/name: (Portal .* Provider)$/gm)].map((match) => match[1]).filter((name) => name !== BASE_PROVIDER);
  assert.deepEqual(names.sort(), OPTIONAL_PROVIDERS.map((entry) => entry.providerName).sort());
  for (const entry of OPTIONAL_PROVIDERS) assert.match(blueprint, new RegExp(`slug: ${entry.slug}$`, 'm'));
});

test('runtime verifier embeds and invokes the optional-provider checks', () => {
  const runtime = readFileSync(resolve(import.meta.dirname, '../scripts/verify-authentik-runtime.mjs'), 'utf8');
  assert.match(runtime, /\$\{buildOptionalProviderVerification\(\)\}/);
  assert.match(runtime, /portal_verify_optional_providers\(outpost, portal_test_provider_names\)/);
  assert.doesNotMatch(code, /sentinel/);
});

test('passes with every optional provider disabled and no optional records', () => {
  expectOk({}, buildWorld({}), []);
});

test('passes with every optional provider fully enabled', () => {
  const env = envFor(ALL_KEYS);
  expectOk(env, buildWorld(env), ALL_KEYS);
});

test('passes when Immich optional HTTPS redirect pair is fully set', () => {
  const env = envFor(['immich-oidc'], IMMICH_HTTPS_PAIR);
  expectOk(env, buildWorld(env), ['immich-oidc']);
});

test('passes when Immich optional Tailnet redirect pair is fully set', () => {
  const env = envFor(['immich-oidc'], IMMICH_TAILNET_PAIR);
  expectOk(env, buildWorld(env), ['immich-oidc']);
});

test('passes when both Immich optional redirect pairs are fully set', () => {
  const env = envFor(['immich-oidc'], { ...IMMICH_HTTPS_PAIR, ...IMMICH_TAILNET_PAIR });
  expectOk(env, buildWorld(env), ['immich-oidc']);
});

test('disabled proxy providers may keep records while unassigned from the outpost', () => {
  expectOk({}, buildWorld({}, { lingering: ['books', 'metrics', 'transmission', 'grocy'] }), []);
});

test('disabled proxy provider still on the outpost fails', () => {
  for (const key of ['books', 'grocy', 'transmission']) {
    const world = buildWorld({}, { lingering: [key] });
    world.outpostProviders.push(`provider-${key}`);
    expectFail({}, world, new RegExp(`optional provider ${key}: disabled provider still assigned to the outpost`));
  }
});

test('unexpected provider on the embedded outpost fails and is named', () => {
  const env = envFor(['grocy', 'transmission']);
  const world = buildWorld(env);
  world.proxyProviders.push(proxyRecord('Rogue Proxy Provider', 'rogue'));
  world.outpostProviders.push('rogue');
  expectFail(env, world, /embedded outpost providers mismatch: unexpected \['Rogue Proxy Provider'\], missing \[\]/);
});

test('enabled proxy provider missing from the outpost fails', () => {
  const env = envFor(['grocy']);
  const world = buildWorld(env);
  world.outpostProviders = world.outpostProviders.filter((pk) => pk !== 'provider-grocy');
  expectFail(env, world, /optional provider grocy: provider not assigned to the embedded outpost/);
});

test('partial OIDC configuration fails without printing the configured secret', () => {
  const env = { PORTAL_IMMICH_OIDC_CLIENT_SECRET: ENV.PORTAL_IMMICH_OIDC_CLIENT_SECRET, PORTAL_IMMICH_OIDC_WEB_LOGIN_CALLBACK_URL: ENV.PORTAL_IMMICH_OIDC_WEB_LOGIN_CALLBACK_URL };
  expectFail(env, buildWorld({}), /optional provider immich-oidc: partially configured; set all or none of PORTAL_IMMICH_OIDC_CLIENT_SECRET, /);
});

test('half-set Immich optional redirect pair fails', () => {
  const env = envFor(['immich-oidc'], { PORTAL_IMMICH_OIDC_HTTPS_LOGIN_CALLBACK_URL: IMMICH_HTTPS_PAIR.PORTAL_IMMICH_OIDC_HTTPS_LOGIN_CALLBACK_URL });
  expectFail(env, buildWorld(env), /immich-oidc: partially configured redirect pair PORTAL_IMMICH_OIDC_HTTPS_LOGIN_CALLBACK_URL, PORTAL_IMMICH_OIDC_HTTPS_LINK_CALLBACK_URL/);
});

test('Transmission enabled without RPC password fails', () => {
  const env = envFor(['transmission']);
  delete env.PORTAL_TRANSMISSION_RPC_PASSWORD;
  expectFail(env, buildWorld(envFor(['transmission'])), /transmission: enabled without required settings: PORTAL_TRANSMISSION_RPC_PASSWORD$/);
});

test('Transmission credential drift fails without printing either credential', () => {
  const env = envFor(['transmission']);
  const world = buildWorld(env);
  world.groups.find((group) => group.name === 'Portal - Owner').attributes.portal_transmission_rpc_password = DRIFTED_SECRET;
  expectFail(env, world, /transmission: group credential password mismatch$/);
});

test('Transmission missing or duplicate Owner credential group fails with a controlled error', () => {
  const env = envFor(['transmission']);
  const cases = [
    (world) => { world.groups = world.groups.filter((group) => group.name !== 'Portal - Owner'); },
    (world) => { world.groups.push({ ...world.groups.find((group) => group.name === 'Portal - Owner') }); },
  ];
  for (const mutate of cases) {
    const world = buildWorld(env);
    mutate(world);
    expectFail(env, world, /transmission: credential group must exist exactly once$/);
  }
});

test('Transmission credentials copied onto a non-Owner group fail', () => {
  const env = envFor(['transmission']);
  const world = buildWorld(env);
  world.groups.find((group) => group.name === 'Portal - Family').attributes.portal_transmission_rpc_password = ENV.PORTAL_TRANSMISSION_RPC_PASSWORD;
  expectFail(env, world, /transmission: upstream credentials present on Portal - Family$/);
});

test('Transmission proxy drift fails closed', () => {
  const env = envFor(['transmission']);
  const cases = [
    [(provider) => { provider.basic_auth_enabled = false; }, /basic auth must be enabled/],
    [(provider) => { provider.property_mappings = []; }, /missing property mapping Portal Transmission Host Header/],
    [(provider) => { provider.intercept_header_auth = true; }, /intercept_header_auth must be disabled/],
  ];
  for (const [mutate, pattern] of cases) {
    const world = buildWorld(env);
    mutate(providerOf(world, 'transmission'));
    expectFail(env, world, pattern);
  }
});

test('Transmission access widened beyond Owner fails', () => {
  const env = envFor(['transmission']);
  const world = buildWorld(env);
  world.bindings.push({ target: 'app-transmission', order: 1, group: 'Portal - Family', enabled: true, negate: false });
  expectFail(env, world, /transmission: policy bindings must be exactly \[\[0, 'Portal - Owner'\]\]/);
});

test('Grocy enabled without internal host fails', () => {
  const env = envFor(['grocy']);
  delete env.PORTAL_GROCY_INTERNAL_HOST;
  expectFail(env, buildWorld(envFor(['grocy'])), /grocy: enabled without required settings: PORTAL_GROCY_INTERNAL_HOST$/);
});

test('Grocy proxy drift fails without printing hosts', () => {
  const env = envFor(['grocy']);
  const cases = [
    [(world) => { providerOf(world, 'grocy').internal_host = 'http://sentinel-other-upstream.test'; }, /grocy: internal_host mismatch$/],
    [(world) => { providerOf(world, 'grocy').external_host = 'https://sentinel-elsewhere.test'; }, /grocy: external_host mismatch$/],
    [(world) => { providerOf(world, 'grocy').skip_path_regex = '^/api/'; }, /grocy: skip_path_regex must be empty$/],
    [(world) => { providerOf(world, 'grocy').basic_auth_enabled = true; }, /grocy: basic auth must be disabled$/],
    [(world) => { world.bindings.unshift({ target: 'app-grocy', order: -1, group: 'Portal - Public', enabled: true, negate: false }); }, /grocy: policy bindings must be exactly/],
    [(world) => { world.bindings = world.bindings.filter((binding) => binding.target !== 'app-grocy'); }, /grocy: application has no enabled policy bindings$/],
    [(world) => { world.bindings.find((binding) => binding.target === 'app-grocy').negate = true; }, /grocy: negated policy binding present$/],
    [(world) => { world.applications.find((app) => app.pk === 'app-grocy').policy_engine_mode = 'all'; }, /grocy: policy_engine_mode must be any$/],
  ];
  for (const [mutate, pattern] of cases) {
    const world = buildWorld(env);
    mutate(world);
    expectFail(env, world, pattern);
  }
});

test('Metrics missing host-header mapping fails', () => {
  const env = envFor(['metrics']);
  const world = buildWorld(env);
  providerOf(world, 'metrics').property_mappings = [];
  expectFail(env, world, /metrics: missing property mapping Portal Metrics Host Header$/);
});

test('OIDC client secret drift fails without printing either secret', () => {
  const env = envFor(['audiobookshelf-oidc']);
  const world = buildWorld(env);
  providerOf(world, 'audiobookshelf-oidc').client_secret = DRIFTED_SECRET;
  expectFail(env, world, /audiobookshelf-oidc: client_secret does not match configuration$/);
});

test('OIDC redirect, scope and mapping drift fails closed', () => {
  const cases = [
    ['audiobookshelf-oidc', (provider) => { provider.redirect_uris[0].matching_mode = 'regex'; }, /redirect URIs must be exactly the configured strict URIs$/],
    ['audiobookshelf-oidc', (provider) => { provider.redirect_uris.pop(); }, /redirect URIs must be exactly the configured strict URIs$/],
    ['immich-oidc', (provider) => { provider.property_mappings.push('scope-email'); }, /immich-oidc: scopes must be exactly openid, profile$/],
    ['immich-oidc', (provider) => { provider.property_mappings.push('map-metrics-host'); }, /immich-oidc: non-scope property mapping attached$/],
    ['immich-oidc', (provider) => { provider.grant_types.push('implicit'); }, /immich-oidc: grant_types must be authorization_code only$/],
    ['immich-oidc', (provider) => { provider.sub_mode = 'user_email'; }, /immich-oidc: sub_mode must be hashed_user_id$/],
  ];
  for (const [key, mutate, pattern] of cases) {
    const env = envFor([key]);
    const world = buildWorld(env);
    mutate(providerOf(world, key));
    expectFail(env, world, pattern);
  }
});

test('disabled OIDC provider with lingering records fails', () => {
  expectFail({}, buildWorld({}, { lingering: ['immich-oidc'] }), /immich-oidc: disabled but application portal-immich-oidc still exists; remove it$/);
});

test('Metrics host-header mapping drift fails closed', () => {
  const env = envFor(['metrics']);
  const cases = [
    // Static/internal host header instead of the configured external host.
    [(world) => { world.propertyMappings[0].expression = 'return {"ak_proxy": {"host_header": "host.docker.internal:8086"}}'; }, /metrics: property mapping expression mismatch for Portal Metrics Host Header$/],
    [(world) => { world.propertyMappings[0].expression = ''; }, /metrics: property mapping expression mismatch for Portal Metrics Host Header$/],
    // A look-alike mapping under another name does not satisfy the spec.
    [(world) => { world.propertyMappings[0].name = 'Portal Metrics Host Header (copy)'; }, /metrics: missing property mapping Portal Metrics Host Header$/],
    // Duplicate same-named mappings make the effective header ambiguous.
    [(world) => {
      world.propertyMappings.push({ pk: 'map-metrics-dup', name: 'Portal Metrics Host Header', expression: 'return {"ak_proxy": {"host_header": "other"}}' });
      providerOf(world, 'metrics').property_mappings.push('map-metrics-dup');
    }, /metrics: expected exactly one property mapping Portal Metrics Host Header$/],
  ];
  for (const [mutate, pattern] of cases) {
    const world = buildWorld(env);
    mutate(world);
    expectFail(env, world, pattern);
  }
});

test('Metrics rejects an additional distinct property mapping', () => {
  const env = envFor(['metrics']);
  const world = buildWorld(env);
  world.propertyMappings.push({ pk: 'map-metrics-extra', name: 'Extra Metrics Mapping', expression: 'return {}' });
  providerOf(world, 'metrics').property_mappings.push('map-metrics-extra');
  expectFail(env, world, /metrics: unexpected property mappings$/);
});

test('Metrics host-header mapping tolerates only whitespace-level differences', () => {
  const env = envFor(['metrics']);
  const world = buildWorld(env);
  world.propertyMappings[0].expression = `\n${world.propertyMappings[0].expression.replaceAll('\n', '   \n')}\n\n`;
  expectOk(env, world, ['metrics']);
});

test('Immich profile mapping that emits or references email fails closed', () => {
  const env = envFor(['immich-oidc']);
  const leaks = [
    'return {\n    "name": request.user.name,\n    "preferred_username": request.user.username,\n    "email": request.user.email,\n}',
    'return {\n    "name": request.user.name,\n    "preferred_username": request.user.email,\n}',
    'return {\n    "name": request.user.name,\n    "preferred_username": request.user.username,\n    "Email_Verified": True,\n}',
  ];
  for (const expression of leaks) {
    const world = buildWorld(env);
    world.scopeMappings.find((mapping) => mapping.pk === 'scope-immich-profile').expression = expression;
    expectFail(env, world, /immich-oidc: scope mapping Portal Immich Profile \(No Email\) must not reference email$/);
  }
});

test('Immich profile mapping swap or rescoping fails closed', () => {
  const env = envFor(['immich-oidc']);
  const cases = [
    // The Audiobookshelf profile mapping is email-free but not the Immich contract.
    [(world) => { providerOf(world, 'immich-oidc').property_mappings = ['scope-openid', 'scope-abs-profile']; }, /immich-oidc: missing scope mapping Portal Immich Profile \(No Email\)$/],
    [(world) => { world.scopeMappings.find((mapping) => mapping.pk === 'scope-immich-profile').expression = 'return {}'; }, /immich-oidc: scope mapping expression mismatch for Portal Immich Profile \(No Email\)$/],
    [(world) => { world.scopeMappings.find((mapping) => mapping.pk === 'scope-immich-profile').scope_name = 'email'; }, /immich-oidc: scopes must be exactly openid, profile$/],
  ];
  for (const [mutate, pattern] of cases) {
    const world = buildWorld(env);
    mutate(world);
    expectFail(env, world, pattern);
  }
});

test('Audiobookshelf profile mapping expression drift fails closed', () => {
  const env = envFor(['audiobookshelf-oidc']);
  const world = buildWorld(env);
  world.scopeMappings.find((mapping) => mapping.pk === 'scope-abs-profile').expression = 'return {"preferred_username": request.user.email}';
  expectFail(env, world, /audiobookshelf-oidc: scope mapping expression mismatch for Portal Audiobookshelf OIDC Profile$/);
});

// ---------------------------------------------------------------------------
// Blueprint parity: the spec above must describe what the blueprint applies,
// not just agree with itself. The blueprint is parsed with its Authentik tags
// intact and rendered for synthetic environments.

const BLUEPRINT_PATH = resolve(import.meta.dirname, '../deploy/authentik/blueprints/portal-access-groups.yaml');
const seqTag = (tag) => ({ tag, identify: () => false, resolve: (value) => value, collection: 'seq', nodeClass: YAMLSeq });
const scalarTag = (tag) => ({ tag, identify: () => false, resolve: (value) => value });

function toTagged(node) {
  if (isScalar(node)) {
    if (node.tag === '!Env') return { $env: String(node.value) };
    if (node.tag === '!KeyOf') return { $keyOf: String(node.value) };
    return node.value;
  }
  if (isSeq(node)) {
    const items = node.items.map(toTagged);
    if (node.tag === '!If' || node.tag === '!Condition' || node.tag === '!Find') return { $tag: node.tag, items };
    return items;
  }
  if (isMap(node)) {
    return Object.fromEntries(node.items.map((pair) => [isScalar(pair.key) ? pair.key.value : String(pair.key), toTagged(pair.value)]));
  }
  if (node == null) return null;
  throw new Error(`unsupported blueprint node ${node?.constructor?.name}`);
}

function loadBlueprintEntries() {
  const document = parseDocument(readFileSync(BLUEPRINT_PATH, 'utf8'), {
    customTags: [scalarTag('!Env'), scalarTag('!KeyOf'), seqTag('!If'), seqTag('!Condition'), seqTag('!Find')],
  });
  assert.deepEqual(document.errors, []);
  return toTagged(document.contents).entries;
}

const BLUEPRINT = loadBlueprintEntries();

// Mirrors Authentik blueprint tag semantics: !Env yields the variable (unset is
// falsy), !Condition applies a boolean mode, !If picks a branch.
function render(node, env) {
  if (Array.isArray(node)) return node.map((item) => render(item, env));
  if (node && typeof node === 'object') {
    if ('$env' in node) return env[node.$env] ?? null;
    if ('$keyOf' in node) return node;
    if (node.$tag === '!If') {
      const [condition, whenTrue, whenFalse] = node.items;
      return render(render(condition, env) ? whenTrue : whenFalse, env);
    }
    if (node.$tag === '!Condition') {
      const [mode, ...args] = node.items;
      const values = args.map((arg) => Boolean(render(arg, env)));
      const all = values.every(Boolean);
      const any = values.some(Boolean);
      const odd = values.filter(Boolean).length % 2 === 1;
      const result = { AND: all, NAND: !all, OR: any, NOR: !any, XOR: odd, XNOR: !odd }[mode];
      assert.notEqual(result, undefined, `unsupported !Condition mode ${mode}`);
      return result;
    }
    if (node.$tag === '!Find') return node;
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, render(value, env)]));
  }
  return node;
}

const envNames = (conditions) => (conditions ?? []).map((condition) => {
  assert.ok(condition && '$env' in condition, `expected a plain !Env condition, got ${JSON.stringify(condition)}`);
  return condition.$env;
});
const findGroupName = (find) => {
  assert.equal(find.$tag, '!Find');
  assert.equal(find.items[0], 'authentik_core.group');
  assert.equal(find.items[1][0], 'name');
  return find.items[1][1];
};
const providerModel = (entry) =>
  entry.kind === 'proxy' ? 'authentik_providers_proxy.proxyprovider' : 'authentik_providers_oauth2.oauth2provider';

function blueprintFor(entry) {
  const providers = BLUEPRINT.filter((item) => item.model === providerModel(entry) && item.identifiers?.name === entry.providerName);
  assert.equal(providers.length, 1, `${entry.key}: expected one blueprint provider`);
  const provider = providers[0];
  const applications = BLUEPRINT.filter((item) => item.model === 'authentik_core.application' && item.identifiers?.slug === entry.slug);
  assert.equal(applications.length, 1, `${entry.key}: expected one blueprint application`);
  const application = applications[0];
  const bindings = BLUEPRINT
    .filter((item) => item.model === 'authentik_policies.policybinding' && item.identifiers?.target?.$keyOf === application.id)
    .sort((a, b) => a.identifiers.order - b.identifiers.order);
  const byId = (id) => {
    const found = BLUEPRINT.filter((item) => item.id === id);
    assert.equal(found.length, 1, `${entry.key}: expected one blueprint entry ${id}`);
    return found[0];
  };
  return { provider, application, bindings, byId };
}

test('spec enable conditions and required settings match the blueprint', () => {
  const source = readFileSync(BLUEPRINT_PATH, 'utf8');
  for (const entry of OPTIONAL_PROVIDERS) {
    const { provider, application, bindings, byId } = blueprintFor(entry);
    const gated = [provider, application, ...bindings];
    if (entry.kind === 'proxy') gated.push(...(provider.attrs.property_mappings ?? []).map((ref) => byId(ref.$keyOf)));
    else gated.push(...provider.attrs.property_mappings.filter((ref) => ref.$keyOf).map((ref) => byId(ref.$keyOf)));
    for (const item of gated) {
      assert.deepEqual(envNames(item.conditions), entry.conditions, `${entry.key}: ${item.model} ${item.id ?? ''} conditions differ from spec`);
    }
    // Settings the verifier demands when enabled must actually feed the blueprint.
    for (const name of entry.requiredWhenEnabled) {
      assert.match(source, new RegExp(`!Env ${name}\\b`), `${entry.key}: ${name} is not used by the blueprint`);
    }
  }
});

test('spec provider, application and binding attributes match the blueprint', () => {
  for (const entry of OPTIONAL_PROVIDERS) {
    const { provider, application, bindings, byId } = blueprintFor(entry);
    const attrs = provider.attrs;
    assert.equal(application.attrs.provider.$keyOf, provider.id, `${entry.key}: application provider`);
    assert.equal(application.attrs.meta_hide, entry.metaHide, `${entry.key}: meta_hide`);
    assert.equal(application.attrs.policy_engine_mode, 'any', `${entry.key}: policy_engine_mode`);
    assert.deepEqual(bindings.map((binding) => binding.identifiers.order), entry.bindings.map((_, order) => order), `${entry.key}: binding orders`);
    assert.deepEqual(bindings.map((binding) => findGroupName(binding.attrs.group)), entry.bindings, `${entry.key}: binding groups`);
    for (const binding of bindings) {
      assert.equal(binding.attrs.enabled, true);
      assert.equal(binding.attrs.negate, false);
    }
    if (entry.kind === 'proxy') {
      if ('literal' in entry.internalHost) assert.equal(attrs.internal_host, entry.internalHost.literal, `${entry.key}: internal_host`);
      else assert.deepEqual(attrs.internal_host, { $env: entry.internalHost.env }, `${entry.key}: internal_host`);
      assert.deepEqual(attrs.external_host, { $env: entry.externalHostEnv }, `${entry.key}: external_host`);
      assert.equal(attrs.mode, 'proxy');
      assert.equal(attrs.skip_path_regex, '');
      assert.equal(attrs.intercept_header_auth, false);
      assert.equal(attrs.basic_auth_enabled, Boolean(entry.basicAuth), `${entry.key}: basic_auth_enabled`);
      if (entry.basicAuth) {
        assert.equal(attrs.basic_auth_user_attribute, entry.basicAuth.userAttribute);
        assert.equal(attrs.basic_auth_password_attribute, entry.basicAuth.passwordAttribute);
        const group = BLUEPRINT.find((item) => item.model === 'authentik_core.group' && item.identifiers?.name === entry.basicAuth.group);
        assert.deepEqual(group.attrs.attributes[entry.basicAuth.userAttribute], { $env: entry.basicAuth.userEnv });
        assert.deepEqual(group.attrs.attributes[entry.basicAuth.passwordAttribute], { $env: entry.basicAuth.passwordEnv });
      }
      const mappings = (attrs.property_mappings ?? []).map((ref) => byId(ref.$keyOf));
      assert.deepEqual(
        mappings.map((mapping) => [mapping.identifiers.name, normalizeExpression(mapping.attrs.expression)]),
        entry.propertyMappings.map((mapping) => [mapping.name, normalizeExpression(mapping.expression)]),
        `${entry.key}: property mappings differ from blueprint`,
      );
    } else {
      assert.equal(attrs.client_type, 'confidential');
      assert.equal(attrs.client_id, entry.clientId);
      assert.deepEqual(attrs.client_secret, { $env: entry.clientSecretEnv });
      assert.deepEqual(attrs.grant_types, ['authorization_code']);
      assert.equal(attrs.sub_mode, 'hashed_user_id');
      assert.equal(attrs.issuer_mode, 'per_provider');
      const custom = attrs.property_mappings.filter((ref) => ref.$keyOf).map((ref) => byId(ref.$keyOf));
      const found = attrs.property_mappings.filter((ref) => ref.$tag === '!Find').map((ref) => {
        assert.equal(ref.items[0], 'authentik_providers_oauth2.scopemapping');
        assert.equal(ref.items[1][0], 'scope_name');
        return ref.items[1][1];
      });
      assert.deepEqual([...found, ...custom.map((mapping) => mapping.attrs.scope_name)].sort(), [...entry.scopes].sort(), `${entry.key}: scopes`);
      assert.deepEqual(
        custom.map((mapping) => [mapping.identifiers.name, mapping.attrs.scope_name, normalizeExpression(mapping.attrs.expression)]),
        entry.customMappings.map((mapping) => [mapping.name, mapping.scopeName, normalizeExpression(mapping.expression)]),
        `${entry.key}: custom scope mappings differ from blueprint`,
      );
      for (const claim of entry.forbiddenClaims) {
        for (const mapping of custom) assert.doesNotMatch(mapping.attrs.expression.toLowerCase(), new RegExp(claim), `${entry.key}: blueprint mapping references ${claim}`);
      }
    }
  }
});

test('Immich is the only provider whose blueprint scopes omit email', () => {
  assert.deepEqual(OPTIONAL_PROVIDERS.filter((entry) => entry.forbiddenClaims?.includes('email')).map((entry) => entry.key), ['immich-oidc']);
  assert.ok(!spec('immich-oidc').scopes.includes('email'));
});

function redirectTuples(uris, env) {
  return uris.map((uri) => [uri.matchingMode ?? uri.matching_mode, uri.env ? env[uri.env] : uri.url, uri.type ?? uri.redirect_uri_type]).sort();
}

test('static OIDC redirect URIs match the blueprint', () => {
  const entry = spec('audiobookshelf-oidc');
  const env = envFor(['audiobookshelf-oidc']);
  const { provider } = blueprintFor(entry);
  assert.deepEqual(redirectTuples(render(provider.attrs.redirect_uris, env), env), redirectTuples(entry.redirectUris, env));
});

test('Immich redirect URIs match every blueprint !If branch and the verifier', () => {
  const entry = spec('immich-oidc');
  const { provider } = blueprintFor(entry);
  const optional = entry.optionalRedirectGroups.flat().map((uri) => uri.env);
  const synthetic = { ...IMMICH_HTTPS_PAIR, ...IMMICH_TAILNET_PAIR };
  assert.deepEqual(optional.sort(), Object.keys(synthetic).sort());
  // Every optional variable must be referenced by the blueprint's redirect expression.
  const referenced = JSON.stringify(provider.attrs.redirect_uris);
  for (const name of optional) assert.ok(referenced.includes(`"$env":"${name}"`), `${name} missing from blueprint redirect_uris`);
  for (let mask = 0; mask < 1 << optional.length; mask += 1) {
    const extra = Object.fromEntries(optional.filter((_, bit) => mask & (1 << bit)).map((name) => [name, synthetic[name]]));
    const env = envFor(['immich-oidc'], extra);
    const rendered = render(provider.attrs.redirect_uris, env);
    const fullPairs = entry.optionalRedirectGroups.filter((pair) => pair.every((uri) => env[uri.env]));
    const halfPair = entry.optionalRedirectGroups.some((pair) => pair.some((uri) => env[uri.env]) && !pair.every((uri) => env[uri.env]));
    const label = `optional vars set: ${Object.keys(extra).join(', ') || 'none'}`;
    // The blueprint applies the base URIs plus each fully-set pair and drops half-set pairs.
    assert.deepEqual(redirectTuples(rendered, env), redirectTuples([...entry.redirectUris, ...fullPairs.flat()], env), label);
    assert.ok(rendered.every((uri) => typeof uri.url === 'string' && uri.url.length > 0), `${label}: blueprint renders an empty redirect URL`);
    // Feed the blueprint-rendered list to the verifier: exact branches pass,
    // half-set pairs are rejected even though the blueprint silently drops them.
    const world = buildWorld(env);
    providerOf(world, 'immich-oidc').redirect_uris = rendered.map((uri) => ({ matching_mode: uri.matching_mode, url: uri.url, redirect_uri_type: uri.redirect_uri_type }));
    if (halfPair) expectFail(env, world, /immich-oidc: partially configured redirect pair /);
    else expectOk(env, world, ['immich-oidc']);
  }
});

test('Immich redirect list from a different branch than the environment fails', () => {
  const env = envFor(['immich-oidc'], IMMICH_HTTPS_PAIR);
  const world = buildWorld(env);
  const { provider } = blueprintFor(spec('immich-oidc'));
  // Stale state: the record still carries the base-only branch after the HTTPS pair was added.
  providerOf(world, 'immich-oidc').redirect_uris = render(provider.attrs.redirect_uris, envFor(['immich-oidc']));
  expectFail(env, world, /immich-oidc: redirect URIs must be exactly the configured strict URIs$/);
});
