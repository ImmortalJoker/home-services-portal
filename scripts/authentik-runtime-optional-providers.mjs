// Spec-driven runtime verification for every optional Authentik provider in
// deploy/authentik/blueprints/portal-access-groups.yaml. The generated Python
// runs inside `ak shell` on the dedicated test stack (see
// verify-authentik-runtime.mjs). Every check fails closed: missing records,
// partial configuration, widened access, or stale outpost assignments raise.
// Failure messages name the provider and field only, never configured values.

const PUBLIC = 'Portal - Public';
const FAMILY = 'Portal - Family';
const OWNER = 'Portal - Owner';
const PENDING = 'Portal - Pending';

export const PORTAL_GROUP_NAMES = [PUBLIC, FAMILY, OWNER, PENDING];

const strict = (env, type = 'authorization') => ({ env, matchingMode: 'strict', type });

// Expressions mirror the blueprint byte-for-byte after normalizeExpression();
// tests/authentik-runtime-optional-providers.test.mjs enforces that parity.
const METRICS_HOST_HEADER_EXPRESSION = [
  'from urllib.parse import urlparse',
  'parsed_url = urlparse(provider.proxyprovider.external_host)',
  'return {"ak_proxy": {"host_header": parsed_url.netloc}}',
].join('\n');
const TRANSMISSION_HOST_HEADER_EXPRESSION = 'return {"ak_proxy": {"host_header": "127.0.0.1:9091"}}';
const AUDIOBOOKSHELF_PROFILE_EXPRESSION = [
  'preferred_username = ak_obj_attr(request.user, "audiobookshelf_username", request.user.username)',
  'return {',
  '    "name": request.user.name,',
  '    "preferred_username": preferred_username,',
  '}',
].join('\n');
const IMMICH_PROFILE_EXPRESSION = [
  'return {',
  '    "name": request.user.name,',
  '    "preferred_username": request.user.username,',
  '}',
].join('\n');

/** Same normalization as portal_normalize_expression in the generated Python. */
export function normalizeExpression(text) {
  return String(text ?? '').trim().split(/\r?\n/).map((line) => line.trimEnd()).join('\n');
}

export const OPTIONAL_PROVIDERS = [
  {
    key: 'books',
    kind: 'proxy',
    conditions: ['PORTAL_BOOKS_EXTERNAL_HOST'],
    requiredWhenEnabled: [],
    providerName: 'Portal Books Protected Service Provider',
    slug: 'portal-books',
    metaHide: false,
    internalHost: { literal: 'http://host.docker.internal:8087' },
    externalHostEnv: 'PORTAL_BOOKS_EXTERNAL_HOST',
    basicAuth: null,
    propertyMappings: [],
    bindings: [PUBLIC, FAMILY, OWNER],
  },
  {
    key: 'audiobookshelf',
    kind: 'proxy',
    conditions: ['PORTAL_AUDIOBOOKSHELF_EXTERNAL_HOST'],
    requiredWhenEnabled: [],
    providerName: 'Portal Audiobookshelf Protected Service Provider',
    slug: 'portal-audiobookshelf',
    metaHide: true,
    internalHost: { literal: 'http://host.docker.internal:13378' },
    externalHostEnv: 'PORTAL_AUDIOBOOKSHELF_EXTERNAL_HOST',
    basicAuth: null,
    propertyMappings: [],
    bindings: [PUBLIC, FAMILY, OWNER],
  },
  {
    key: 'metrics',
    kind: 'proxy',
    conditions: ['PORTAL_METRICS_EXTERNAL_HOST'],
    requiredWhenEnabled: [],
    providerName: 'Portal Metrics Protected Service Provider',
    slug: 'portal-metrics',
    metaHide: false,
    internalHost: { literal: 'http://host.docker.internal:8086' },
    externalHostEnv: 'PORTAL_METRICS_EXTERNAL_HOST',
    basicAuth: null,
    // The host header must follow the configured external host; a static or
    // internal value would let requests reach the upstream under another vhost.
    propertyMappings: [{ name: 'Portal Metrics Host Header', expression: METRICS_HOST_HEADER_EXPRESSION }],
    bindings: [OWNER],
  },
  {
    key: 'transmission',
    kind: 'proxy',
    conditions: ['PORTAL_TRANSMISSION_EXTERNAL_HOST'],
    // Basic auth with empty credentials would leave the RPC either broken or
    // relying on an unauthenticated upstream; require both when enabled.
    requiredWhenEnabled: ['PORTAL_TRANSMISSION_RPC_USERNAME', 'PORTAL_TRANSMISSION_RPC_PASSWORD'],
    providerName: 'Portal Transmission Protected Service Provider',
    slug: 'portal-transmission',
    metaHide: false,
    internalHost: { literal: 'http://host.docker.internal:9091' },
    externalHostEnv: 'PORTAL_TRANSMISSION_EXTERNAL_HOST',
    basicAuth: {
      userAttribute: 'portal_transmission_rpc_username',
      passwordAttribute: 'portal_transmission_rpc_password',
      userEnv: 'PORTAL_TRANSMISSION_RPC_USERNAME',
      passwordEnv: 'PORTAL_TRANSMISSION_RPC_PASSWORD',
      group: OWNER,
    },
    propertyMappings: [{ name: 'Portal Transmission Host Header', expression: TRANSMISSION_HOST_HEADER_EXPRESSION }],
    bindings: [OWNER],
  },
  {
    key: 'grocy',
    kind: 'proxy',
    conditions: ['PORTAL_GROCY_EXTERNAL_HOST'],
    requiredWhenEnabled: ['PORTAL_GROCY_INTERNAL_HOST'],
    providerName: 'Portal Grocy Protected Service Provider',
    slug: 'portal-grocy',
    metaHide: false,
    internalHost: { env: 'PORTAL_GROCY_INTERNAL_HOST' },
    externalHostEnv: 'PORTAL_GROCY_EXTERNAL_HOST',
    basicAuth: null,
    propertyMappings: [],
    bindings: [FAMILY, OWNER],
  },
  {
    key: 'audiobookshelf-oidc',
    kind: 'oauth2',
    conditions: [
      'PORTAL_AUDIOBOOKSHELF_OIDC_CLIENT_SECRET',
      'PORTAL_AUDIOBOOKSHELF_OIDC_WEB_CALLBACK_URL',
      'PORTAL_AUDIOBOOKSHELF_OIDC_MOBILE_CALLBACK_URL',
      'PORTAL_AUDIOBOOKSHELF_OIDC_LOGOUT_CALLBACK_URL',
    ],
    requiredWhenEnabled: [],
    providerName: 'Portal Audiobookshelf OIDC Provider',
    slug: 'portal-audiobookshelf-oidc',
    metaHide: true,
    clientId: 'audiobookshelf-oidc',
    clientSecretEnv: 'PORTAL_AUDIOBOOKSHELF_OIDC_CLIENT_SECRET',
    redirectUris: [
      strict('PORTAL_AUDIOBOOKSHELF_OIDC_WEB_CALLBACK_URL'),
      strict('PORTAL_AUDIOBOOKSHELF_OIDC_MOBILE_CALLBACK_URL'),
      strict('PORTAL_AUDIOBOOKSHELF_OIDC_LOGOUT_CALLBACK_URL', 'logout'),
    ],
    optionalRedirectGroups: [],
    scopes: ['email', 'openid', 'profile'],
    customMappings: [{ name: 'Portal Audiobookshelf OIDC Profile', scopeName: 'profile', expression: AUDIOBOOKSHELF_PROFILE_EXPRESSION }],
    forbiddenClaims: [],
    bindings: [PUBLIC, FAMILY, OWNER],
  },
  {
    key: 'immich-oidc',
    kind: 'oauth2',
    conditions: [
      'PORTAL_IMMICH_OIDC_CLIENT_SECRET',
      'PORTAL_IMMICH_OIDC_WEB_LOGIN_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_WEB_LINK_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_LAN_LOGIN_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_LAN_LINK_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_MOBILE_CALLBACK_URL',
    ],
    requiredWhenEnabled: [],
    providerName: 'Portal Immich OIDC Provider',
    slug: 'portal-immich-oidc',
    metaHide: true,
    clientId: 'immich-oidc',
    clientSecretEnv: 'PORTAL_IMMICH_OIDC_CLIENT_SECRET',
    redirectUris: [
      strict('PORTAL_IMMICH_OIDC_WEB_LOGIN_CALLBACK_URL'),
      strict('PORTAL_IMMICH_OIDC_WEB_LINK_CALLBACK_URL'),
      strict('PORTAL_IMMICH_OIDC_LAN_LOGIN_CALLBACK_URL'),
      strict('PORTAL_IMMICH_OIDC_LAN_LINK_CALLBACK_URL'),
      strict('PORTAL_IMMICH_OIDC_MOBILE_CALLBACK_URL'),
    ],
    // Each pair is added only when both members are set; a half-set pair is
    // silently dropped by the blueprint, so the verifier rejects it.
    optionalRedirectGroups: [
      [strict('PORTAL_IMMICH_OIDC_HTTPS_LOGIN_CALLBACK_URL'), strict('PORTAL_IMMICH_OIDC_HTTPS_LINK_CALLBACK_URL')],
      [strict('PORTAL_IMMICH_OIDC_TAILNET_LOGIN_CALLBACK_URL'), strict('PORTAL_IMMICH_OIDC_TAILNET_LINK_CALLBACK_URL')],
    ],
    // No email scope: Immich must link by subject, never by email.
    scopes: ['openid', 'profile'],
    customMappings: [{ name: 'Portal Immich Profile (No Email)', scopeName: 'profile', expression: IMMICH_PROFILE_EXPRESSION }],
    // Immich links accounts by email when it receives one; the custom mapping
    // must never emit or reference an email claim.
    forbiddenClaims: ['email'],
    bindings: [FAMILY, OWNER],
  },
];

const pythonSource = String.raw`
import json as portal_json
import os as portal_os
from authentik.core.models import Application as PortalApplication, Group as PortalGroup
from authentik.policies.models import PolicyBinding as PortalPolicyBinding
from authentik.providers.oauth2.models import OAuth2Provider as PortalOAuth2Provider, ScopeMapping as PortalScopeMapping
from authentik.providers.proxy.models import ProxyProvider as PortalProxyProvider

PORTAL_OPTIONAL_PROVIDERS = portal_json.loads(__PORTAL_SPEC__)
PORTAL_GROUP_NAMES = portal_json.loads(__PORTAL_GROUPS__)


def portal_require(condition, key, message):
    if not condition:
        raise AssertionError('optional provider ' + key + ': ' + message)


def portal_env(name):
    return portal_os.environ.get(name) or ''


def portal_value(value):
    return getattr(value, 'value', value)


def portal_field(entry, name):
    if isinstance(entry, dict):
        return entry.get(name)
    return getattr(entry, name, None)


def portal_normalize_expression(text):
    return '\n'.join(line.rstrip() for line in str(text or '').strip().splitlines())


def portal_expected(spec, value):
    if 'literal' in value:
        return value['literal']
    return portal_env(value['env'])


def portal_provider_model(spec):
    return PortalProxyProvider if spec['kind'] == 'proxy' else PortalOAuth2Provider


def portal_is_enabled(spec):
    present = [name for name in spec['conditions'] if portal_env(name)]
    portal_require(
        len(present) in (0, len(spec['conditions'])),
        spec['key'],
        'partially configured; set all or none of ' + ', '.join(spec['conditions']),
    )
    if not present:
        return False
    missing = [name for name in spec['requiredWhenEnabled'] if not portal_env(name)]
    portal_require(not missing, spec['key'], 'enabled without required settings: ' + ', '.join(missing))
    return True


def portal_verify_bindings(spec, application):
    key = spec['key']
    portal_require(str(portal_value(application.policy_engine_mode)) == 'any', key, 'policy_engine_mode must be any')
    bindings = list(PortalPolicyBinding.objects.filter(target=application, enabled=True).order_by('order'))
    # An application with no enabled bindings is open to every authenticated user.
    portal_require(bindings, key, 'application has no enabled policy bindings')
    actual = []
    for binding in bindings:
        portal_require(binding.negate is False, key, 'negated policy binding present')
        portal_require(binding.user is None, key, 'user policy binding present')
        portal_require(binding.policy is None, key, 'policy-object binding present')
        portal_require(binding.group is not None, key, 'binding without group present')
        actual.append([binding.order, binding.group.name])
    expected = [[order, name] for order, name in enumerate(spec['bindings'])]
    portal_require(actual == expected, key, 'policy bindings must be exactly ' + repr(expected))


def portal_verify_application(spec, provider):
    key = spec['key']
    applications = PortalApplication.objects.filter(slug=spec['slug'])
    portal_require(applications.count() == 1, key, 'expected exactly one application ' + spec['slug'])
    application = applications.first()
    portal_require(
        application.provider is not None and application.provider.pk == provider.pk,
        key,
        'application is not bound to its provider',
    )
    portal_require(bool(application.meta_hide) == spec['metaHide'], key, 'meta_hide mismatch')
    portal_verify_bindings(spec, application)


def portal_verify_proxy(spec, provider, outpost):
    key = spec['key']
    portal_require(provider.internal_host == portal_expected(spec, spec['internalHost']), key, 'internal_host mismatch')
    portal_require(
        (provider.external_host or '').rstrip('/') == portal_env(spec['externalHostEnv']).rstrip('/'),
        key,
        'external_host mismatch',
    )
    portal_require(str(portal_value(provider.mode)) == 'proxy', key, 'mode must be proxy')
    # Any skip path would expose upstream routes without Authentik authorization.
    portal_require((provider.skip_path_regex or '').strip() == '', key, 'skip_path_regex must be empty')
    portal_require(provider.intercept_header_auth is False, key, 'intercept_header_auth must be disabled')
    basic = spec['basicAuth']
    if basic:
        portal_require(provider.basic_auth_enabled is True, key, 'basic auth must be enabled')
        portal_require(provider.basic_auth_user_attribute == basic['userAttribute'], key, 'basic auth user attribute mismatch')
        portal_require(provider.basic_auth_password_attribute == basic['passwordAttribute'], key, 'basic auth password attribute mismatch')
        credential_groups = PortalGroup.objects.filter(name=basic['group'])
        portal_require(credential_groups.count() == 1, key, 'credential group must exist exactly once')
        attributes = credential_groups.first().attributes or {}
        portal_require(attributes.get(basic['userAttribute']) == portal_env(basic['userEnv']), key, 'group credential username mismatch')
        portal_require(attributes.get(basic['passwordAttribute']) == portal_env(basic['passwordEnv']), key, 'group credential password mismatch')
        for group in PortalGroup.objects.filter(name__in=[name for name in PORTAL_GROUP_NAMES if name != basic['group']]):
            other = group.attributes or {}
            portal_require(
                not other.get(basic['userAttribute']) and not other.get(basic['passwordAttribute']),
                key,
                'upstream credentials present on ' + group.name,
            )
    else:
        portal_require(provider.basic_auth_enabled is False, key, 'basic auth must be disabled')
    mapping_names = set(provider.property_mappings.values_list('name', flat=True))
    for mapping in spec['propertyMappings']:
        portal_require(mapping['name'] in mapping_names, key, 'missing property mapping ' + mapping['name'])
        attached = list(provider.property_mappings.filter(name=mapping['name']))
        portal_require(len(attached) == 1, key, 'expected exactly one property mapping ' + mapping['name'])
        portal_require(
            portal_normalize_expression(getattr(attached[0], 'expression', '')) == portal_normalize_expression(mapping['expression']),
            key,
            'property mapping expression mismatch for ' + mapping['name'],
        )
    portal_require(mapping_names == {mapping['name'] for mapping in spec['propertyMappings']}, key, 'unexpected property mappings')
    portal_require(outpost.providers.filter(pk=provider.pk).exists(), key, 'provider not assigned to the embedded outpost')


def portal_redirect_key(entry):
    return [
        str(portal_value(portal_field(entry, 'matching_mode'))),
        str(portal_field(entry, 'url')),
        str(portal_value(portal_field(entry, 'redirect_uri_type'))),
    ]


def portal_verify_oauth2(spec, provider):
    key = spec['key']
    portal_require(str(portal_value(provider.client_type)) == 'confidential', key, 'client_type must be confidential')
    portal_require(provider.client_id == spec['clientId'], key, 'client_id mismatch')
    portal_require(provider.client_secret == portal_env(spec['clientSecretEnv']), key, 'client_secret does not match configuration')
    portal_require([str(portal_value(g)) for g in (provider.grant_types or [])] == ['authorization_code'], key, 'grant_types must be authorization_code only')
    portal_require(str(portal_value(provider.sub_mode)) == 'hashed_user_id', key, 'sub_mode must be hashed_user_id')
    portal_require(str(portal_value(provider.issuer_mode)) == 'per_provider', key, 'issuer_mode must be per_provider')
    expected_uris = list(spec['redirectUris'])
    for group in spec['optionalRedirectGroups']:
        present = [uri for uri in group if portal_env(uri['env'])]
        portal_require(len(present) in (0, len(group)), key, 'partially configured redirect pair ' + ', '.join(uri['env'] for uri in group))
        if present:
            expected_uris.extend(group)
    expected = sorted([uri['matchingMode'], portal_env(uri['env']), uri['type']] for uri in expected_uris)
    actual = sorted(portal_redirect_key(entry) for entry in (provider.redirect_uris or []))
    portal_require(actual == expected, key, 'redirect URIs must be exactly the configured strict URIs')
    mapping_pks = list(provider.property_mappings.values_list('pk', flat=True))
    scopes = list(PortalScopeMapping.objects.filter(pk__in=mapping_pks))
    portal_require(len(scopes) == len(mapping_pks), key, 'non-scope property mapping attached')
    portal_require(sorted(scope.scope_name for scope in scopes) == sorted(spec['scopes']), key, 'scopes must be exactly ' + ', '.join(spec['scopes']))
    for mapping in spec['customMappings']:
        name = mapping['name']
        matches = [scope for scope in scopes if scope.name == name]
        portal_require(len(matches) == 1, key, 'missing scope mapping ' + name)
        scope = matches[0]
        portal_require(scope.scope_name == mapping['scopeName'], key, 'scope mapping ' + name + ' must use scope ' + mapping['scopeName'])
        expression = portal_normalize_expression(getattr(scope, 'expression', ''))
        for claim in spec['forbiddenClaims']:
            # Checked before exact parity so the failure names the rule.
            portal_require(claim not in expression.lower(), key, 'scope mapping ' + name + ' must not reference ' + claim)
        portal_require(expression == portal_normalize_expression(mapping['expression']), key, 'scope mapping expression mismatch for ' + name)


def portal_verify_disabled(spec, outpost):
    key = spec['key']
    model = portal_provider_model(spec)
    application = PortalApplication.objects.filter(slug=spec['slug']).first()
    provider = model.objects.filter(name=spec['providerName']).first()
    if spec['kind'] == 'proxy':
        # The blueprint does not delete records; unreachable is the disabled state.
        if provider is not None:
            portal_require(not outpost.providers.filter(pk=provider.pk).exists(), key, 'disabled provider still assigned to the outpost')
        if application is not None and application.provider is not None:
            portal_require(not outpost.providers.filter(pk=application.provider.pk).exists(), key, 'disabled application provider still assigned to the outpost')
    else:
        # OAuth2 clients have no outpost gate; stale records stay usable for sign-in.
        portal_require(application is None, key, 'disabled but application ' + spec['slug'] + ' still exists; remove it')
        portal_require(provider is None, key, 'disabled but provider still exists; remove it')


def portal_verify_optional_providers(outpost, base_provider_names):
    expected_outpost = set(base_provider_names)
    enabled_keys = []
    for spec in PORTAL_OPTIONAL_PROVIDERS:
        if not portal_is_enabled(spec):
            portal_verify_disabled(spec, outpost)
            continue
        model = portal_provider_model(spec)
        providers = model.objects.filter(name=spec['providerName'])
        portal_require(providers.count() == 1, spec['key'], 'expected exactly one provider')
        provider = providers.first()
        if spec['kind'] == 'proxy':
            portal_verify_proxy(spec, provider, outpost)
            expected_outpost.add(spec['providerName'])
        else:
            portal_verify_oauth2(spec, provider)
        portal_verify_application(spec, provider)
        enabled_keys.append(spec['key'])
    actual_outpost = set(outpost.providers.values_list('name', flat=True))
    if actual_outpost != expected_outpost:
        raise AssertionError(
            'embedded outpost providers mismatch: unexpected ' + repr(sorted(actual_outpost - expected_outpost))
            + ', missing ' + repr(sorted(expected_outpost - actual_outpost))
        )
    return enabled_keys


# Functions resolve each other through globals; make that hold even if the
# shell executes this source with separate globals and locals mappings.
globals().update({name: value for name, value in list(locals().items()) if name.lower().startswith('portal')})
`;

/** Python definitions (imports, spec, and `portal_verify_optional_providers`). */
export function buildOptionalProviderVerification() {
  return pythonSource
    .replace('__PORTAL_SPEC__', JSON.stringify(JSON.stringify(OPTIONAL_PROVIDERS)))
    .replace('__PORTAL_GROUPS__', JSON.stringify(JSON.stringify(PORTAL_GROUP_NAMES)));
}
