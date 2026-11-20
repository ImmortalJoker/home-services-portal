import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAuthentikBlueprint } from './helpers/authentikBlueprint';

const compose = readFileSync(resolve(process.cwd(), 'deploy/authentik/compose.yml'), 'utf8');
const authentikEnvExample = readFileSync(resolve(process.cwd(), 'deploy/authentik/.env.example'), 'utf8');
const authentikSetup = readFileSync(resolve(process.cwd(), 'deploy/authentik/setup-local.sh'), 'utf8');
const portalDockerfile = readFileSync(resolve(process.cwd(), 'deploy/authentik/portal/Dockerfile'), 'utf8');
const ciWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
const blueprint = loadAuthentikBlueprint();
const portalConfig = JSON.parse(readFileSync(resolve(process.cwd(), 'deploy/authentik/portal-services.json.example'), 'utf8'));
const entry = (model: string) => blueprint.entries.find((item) => item.model === model);
const bindings = blueprint.entries.filter((item) => item.model === 'authentik_policies.policybinding' && item.identifiers?.target === 'portal-test-application');
function policyGroupName(binding: typeof bindings[number]) {
  const reference = binding.attrs?.group;
  if (!Array.isArray(reference) || !Array.isArray(reference[1])) return undefined;
  return reference[1][1];
}

function evaluateCondition(condition: unknown, environment: Record<string, boolean>): boolean {
  if (typeof condition === 'string') return environment[condition] ?? false;
  if (!Array.isArray(condition) || typeof condition[0] !== 'string') return false;
  const [operator, ...operands] = condition;
  if (operator === 'AND') return operands.every((operand) => evaluateCondition(operand, environment));
  if (operator === 'NAND') return !operands.every((operand) => evaluateCondition(operand, environment));
  throw new Error(`Unsupported blueprint condition operator: ${operator}`);
}

describe('protected Authentik portal demo', () => {
  it('lets Portal Owners review Pending users and manage Public and Family grants without granting Owner access', () => {
    const role = blueprint.entries.find((item) => item.id === 'portal-access-manager-role');
    const ownerGroup = blueprint.entries.find((item) => item.identifiers?.name === 'Portal - Owner' && item.model === 'authentik_core.group');
    const pendingGroup = blueprint.entries.find((item) => item.identifiers?.name === 'Portal - Pending' && item.model === 'authentik_core.group');
    const targetGroups = ['Portal - Public', 'Portal - Family'].map((name) =>
      blueprint.entries.find((item) => item.identifiers?.name === name && item.model === 'authentik_core.group'));
    const managedPermissions = targetGroups.map((group) => group?.permissions);
    const pendingPermissions = pendingGroup?.permissions ?? [];
    const ownerPermissions = ownerGroup?.permissions ?? [];

    expect(role?.model).toBe('authentik_rbac.role');
    expect(role?.attrs?.permissions).toContain('authentik_rbac.access_admin_interface');
    expect(role?.attrs?.permissions).toContain('authentik_core.view_user');
    expect(ownerGroup?.attrs?.roles).toContain('portal-access-manager-role');
    expect(managedPermissions).toEqual([
      expect.arrayContaining([
        { permission: 'authentik_core.view_group', role: 'portal-access-manager-role' },
        { permission: 'authentik_core.add_user_to_group', role: 'portal-access-manager-role' },
        { permission: 'authentik_core.remove_user_from_group', role: 'portal-access-manager-role' },
      ]),
      expect.arrayContaining([
        { permission: 'authentik_core.view_group', role: 'portal-access-manager-role' },
        { permission: 'authentik_core.add_user_to_group', role: 'portal-access-manager-role' },
        { permission: 'authentik_core.remove_user_from_group', role: 'portal-access-manager-role' },
      ]),
    ]);
    expect(pendingPermissions).toEqual([
      { permission: 'authentik_core.view_group', role: 'portal-access-manager-role' },
    ]);
    expect(ownerPermissions).toEqual([]);
  });

  it('creates internal accounts in Pending through the invitation flow until the owner approves them', () => {
    const flow = blueprint.entries.find((item) => item.id === 'portal-invitation-flow');
    const invitationStage = blueprint.entries.find((item) => item.id === 'portal-invitation-stage');
    const userWriteStage = blueprint.entries.find((item) => item.id === 'portal-invitation-user-write');
    const invitations = blueprint.entries.filter((item) => item.model === 'authentik_stages_invitation.invitation');
    const stageBindings = blueprint.entries.filter((item) => item.model === 'authentik_flows.flowstagebinding' && item.identifiers?.target === 'portal-invitation-flow');

    expect(flow?.model).toBe('authentik_flows.flow');
    expect(flow?.identifiers?.slug).toBe('portal-invitation-enrollment');
    expect(flow?.attrs?.designation).toBe('enrollment');
    expect(flow?.attrs?.authentication).toBe('require_unauthenticated');
    expect(invitationStage?.model).toBe('authentik_stages_invitation.invitationstage');
    expect(invitationStage?.attrs?.continue_flow_without_invitation).toBe(false);
    expect(userWriteStage?.attrs?.create_users_group).toEqual(['authentik_core.group', ['name', 'Portal - Pending']]);
    expect(userWriteStage?.attrs?.user_type).toBe('internal');
    expect(invitations).toHaveLength(0);
    expect(stageBindings.map((binding) => binding.identifiers?.order)).toEqual([5, 10, 15, 20, 100]);
    expect(stageBindings.every((binding) => binding.identifiers?.stage !== undefined)).toBe(true);
  });

  it('keeps Google-enrolled accounts external and in Pending, with a direct default-application destination', () => {
    const pendingGroup = blueprint.entries.find((item) => item.model === 'authentik_core.group' && item.identifiers?.name === 'Portal - Pending');
    const flow = blueprint.entries.find((item) => item.id === 'portal-google-pending-flow');
    const userWriteStage = blueprint.entries.find((item) => item.id === 'portal-google-pending-user-write');
    const invitationBindings = blueprint.entries.filter((item) => item.model === 'authentik_flows.flowstagebinding' && item.identifiers?.target === 'portal-google-pending-flow');

    expect(pendingGroup?.attrs?.is_superuser).toBe(false);
    expect(flow?.identifiers?.slug).toBe('portal-google-pending-enrollment');
    expect(flow?.attrs?.designation).toBe('enrollment');
    expect(flow?.attrs?.authentication).toBe('none');
    expect(userWriteStage?.attrs?.user_type).toBe('external');
    expect(userWriteStage?.attrs?.create_users_group).toEqual(['authentik_core.group', ['name', 'Portal - Pending']]);
    expect(invitationBindings.map((binding) => binding.identifiers?.order)).toEqual([0, 1, 2]);
    expect(invitationBindings.some((binding) => binding.identifiers?.stage === 'portal-invitation-stage')).toBe(false);
    const defaultBrand = blueprint.entries.find((item) => item.model === 'authentik_brands.brand' && item.identifiers?.domain === 'authentik-default');
    expect(defaultBrand?.conditions).toEqual(['PORTAL_TEST_EXTERNAL_HOST']);
    expect(defaultBrand?.attrs?.default_application).toBe('portal-test-application');
    expect(defaultBrand?.attrs?.flow_user_switch).toEqual([
      'authentik_flows.flow', ['slug', 'default-authentication-flow'],
    ]);
  });

  it('configures a local Authentik Admins notification rule for User Write events', () => {
    const matcher = blueprint.entries.find((item) => item.id === 'portal-invitation-user-write-event');
    const rule = blueprint.entries.find((item) => item.id === 'portal-new-account-notification');
    const binding = blueprint.entries.find((item) => item.model === 'authentik_policies.policybinding' && item.identifiers?.target === 'portal-new-account-notification');

    expect(matcher?.model).toBe('authentik_policies_event_matcher.eventmatcherpolicy');
    expect(matcher?.attrs?.action).toBe('user_write');
    expect(rule?.model).toBe('authentik_events.notificationrule');
    expect(rule?.identifiers?.name).toBe('Portal new account owner notification');
    expect(rule?.attrs?.destination_group).toEqual(['authentik_core.group', ['name', 'authentik Admins']]);
    expect(rule?.attrs?.destination_event_user).toBe(false);
    expect(rule?.attrs?.transports).toEqual([
      ['authentik_events.notificationtransport', ['name', 'default-local-transport']],
    ]);
    expect(binding?.attrs?.policy).toBe('portal-invitation-user-write-event');
    expect(binding?.attrs?.enabled).toBe(true);
  });

  it('runs the upstream in a non-root, read-only container without publishing its port', () => {
    const service = compose.split('  portal-test:\n')[1]?.split('\n  server:\n')[0] ?? '';
    expect(service).toContain('deploy/authentik/portal/Dockerfile');
    expect(service).toContain('user: "1000:1000"');
    expect(service).toContain('read_only: true');
    expect(service).toContain('portal-services.json.example');
    expect(service).not.toMatch(/^\s*ports:/m);
    expect(service).toContain('cap_drop:');
    expect(service).toContain('no-new-privileges:true');
  });

  it('builds the Authentik portal privately while opting GitHub Pages into the public demo', () => {
    expect(portalDockerfile).toContain('VITE_PORTAL_PUBLIC_DEMO=false');
    expect(ciWorkflow).toContain('VITE_PORTAL_PUBLIC_DEMO: \'false\'');
    expect(ciWorkflow).toContain('VITE_PORTAL_PUBLIC_DEMO: \'true\'');
  });

  it('creates a proxy provider only when the optional external URL is configured', () => {
    const provider = entry('authentik_providers_proxy.proxyprovider');
    expect(provider?.conditions).toEqual(['PORTAL_TEST_EXTERNAL_HOST']);
    expect(provider?.attrs?.internal_host).toBe('http://portal-test:8080');
    expect(provider?.attrs?.external_host).toBe('PORTAL_TEST_EXTERNAL_HOST');
    expect(provider?.attrs?.mode).toBe('proxy');
  });

  it('allows each portal group at the proxy while relying on the upstream for per-route enforcement', () => {
    const application = entry('authentik_core.application');
    expect(application?.identifiers?.slug).toBe('portal-test');
    expect(application?.attrs?.provider).toBe('portal-test-provider');
    expect(application?.attrs?.policy_engine_mode).toBe('any');
    expect(bindings.map((binding) => binding.identifiers?.order)).toEqual([0, 1, 2, 3]);
    expect(bindings.every((binding) => binding.identifiers?.target === 'portal-test-application')).toBe(true);
    expect(bindings.map(policyGroupName)).toEqual([
      'Portal - Public', 'Portal - Family', 'Portal - Owner', 'Portal - Pending',
    ]);
    expect(bindings.every((binding) => binding.attrs?.enabled === true && binding.attrs?.negate === false)).toBe(true);
  });

  it('assigns only configured providers to the embedded outpost for every optional-service combination', () => {
    const outposts = blueprint.entries.filter((item) => item.model === 'authentik_outposts.outpost');
    const optionalHosts = [
      ['PORTAL_TEST_EXTERNAL_HOST', 'portal-test-provider'],
      ['PORTAL_BOOKS_EXTERNAL_HOST', 'portal-books-provider'],
      ['PORTAL_AUDIOBOOKSHELF_EXTERNAL_HOST', 'portal-audiobookshelf-provider'],
      ['PORTAL_METRICS_EXTERNAL_HOST', 'portal-metrics-provider'],
      ['PORTAL_TRANSMISSION_EXTERNAL_HOST', 'portal-transmission-provider'],
      ['PORTAL_GROCY_EXTERNAL_HOST', 'portal-grocy-provider'],
    ] as const;

    expect(outposts).toHaveLength(64);
    for (let combination = 0; combination < 2 ** optionalHosts.length; combination += 1) {
      const environment = Object.fromEntries(optionalHosts.map(([variable], index) => [
        variable,
        Boolean(combination & (1 << index)),
      ]));
      const expectedProviders = optionalHosts
        .filter(([variable]) => environment[variable])
        .map(([, provider]) => provider);
      const matching = outposts.filter((item) =>
        evaluateCondition(item.conditions?.[0], environment));

      expect(matching).toHaveLength(1);
      expect(matching[0].attrs?.providers).toEqual(expectedProviders);
    }
  });

  it('defines a Calibre proxy application that is disabled until its private external host is configured', () => {
    const provider = blueprint.entries.find((item) => item.id === 'portal-books-provider');
    const application = blueprint.entries.find((item) => item.id === 'portal-books-application');
    const bindings = blueprint.entries.filter((item) =>
      item.model === 'authentik_policies.policybinding' && item.identifiers?.target === 'portal-books-application');
    expect(provider?.conditions).toEqual(['PORTAL_BOOKS_EXTERNAL_HOST']);
    expect(provider?.attrs?.internal_host).toBe('http://host.docker.internal:8087');
    expect(provider?.attrs?.external_host).toBe('PORTAL_BOOKS_EXTERNAL_HOST');
    expect(application?.identifiers?.slug).toBe('portal-books');
    expect(application?.attrs?.provider).toBe('portal-books-provider');
    expect(bindings.map((binding) => binding.identifiers?.order)).toEqual([0, 1, 2]);
    expect(bindings.map(policyGroupName)).toEqual(['Portal - Public', 'Portal - Family', 'Portal - Owner']);
    expect(bindings.every((binding) => binding.conditions?.[0] === 'PORTAL_BOOKS_EXTERNAL_HOST')).toBe(true);
  });

  it('defines an Audiobookshelf proxy application only when its private host is configured', () => {
    const provider = blueprint.entries.find((item) => item.id === 'portal-audiobookshelf-provider');
    const application = blueprint.entries.find((item) => item.id === 'portal-audiobookshelf-application');
    const bindings = blueprint.entries.filter((item) =>
      item.model === 'authentik_policies.policybinding' && item.identifiers?.target === 'portal-audiobookshelf-application');
    expect(provider?.conditions).toEqual(['PORTAL_AUDIOBOOKSHELF_EXTERNAL_HOST']);
    expect(provider?.attrs?.internal_host).toBe('http://host.docker.internal:13378');
    expect(provider?.attrs?.external_host).toBe('PORTAL_AUDIOBOOKSHELF_EXTERNAL_HOST');
    expect(application?.identifiers?.slug).toBe('portal-audiobookshelf');
    expect(application?.attrs?.provider).toBe('portal-audiobookshelf-provider');
    expect(application?.attrs?.meta_hide).toBe(true);
    expect(bindings.map((binding) => binding.identifiers?.order)).toEqual([0, 1, 2]);
    expect(bindings.map(policyGroupName)).toEqual(['Portal - Public', 'Portal - Family', 'Portal - Owner']);
    expect(bindings.every((binding) => binding.conditions?.[0] === 'PORTAL_AUDIOBOOKSHELF_EXTERNAL_HOST')).toBe(true);
  });

  it('uses exact native-route callbacks for web, mobile and logout without the retired gateway', () => {
    const provider = blueprint.entries.find((item) => item.id === 'portal-audiobookshelf-oidc-provider');
    const redirectUris = provider?.attrs?.redirect_uris as Array<Record<string, unknown>>;
    expect(redirectUris).toHaveLength(3);
    expect(redirectUris.map((uri) => uri.matching_mode)).toEqual(['strict', 'strict', 'strict']);
    expect(redirectUris.map((uri) => uri.url)).toEqual([
      'PORTAL_AUDIOBOOKSHELF_OIDC_WEB_CALLBACK_URL',
      'PORTAL_AUDIOBOOKSHELF_OIDC_MOBILE_CALLBACK_URL',
      'PORTAL_AUDIOBOOKSHELF_OIDC_LOGOUT_CALLBACK_URL',
    ]);
  });

  it('defines an opt-in Owner-only metrics proxy with the accepted host header', () => {
    const provider = blueprint.entries.find((item) => item.id === 'portal-metrics-provider');
    const mapping = blueprint.entries.find((item) => item.id === 'portal-metrics-host-header');
    const application = blueprint.entries.find((item) => item.id === 'portal-metrics-application');
    const bindings = blueprint.entries.filter((item) =>
      item.model === 'authentik_policies.policybinding' && item.identifiers?.target === 'portal-metrics-application');

    expect(provider?.conditions).toEqual(['PORTAL_METRICS_EXTERNAL_HOST']);
    expect(provider?.attrs?.internal_host).toBe('http://host.docker.internal:8086');
    expect(provider?.attrs?.external_host).toBe('PORTAL_METRICS_EXTERNAL_HOST');
    expect(provider?.attrs?.property_mappings).toEqual(['portal-metrics-host-header']);
    expect(mapping?.model).toBe('authentik_providers_oauth2.scopemapping');
    expect(mapping?.attrs?.expression).toContain('host_header');
    expect(application?.identifiers?.slug).toBe('portal-metrics');
    expect(application?.attrs?.provider).toBe('portal-metrics-provider');
    expect(bindings.map(policyGroupName)).toEqual(['Portal - Owner']);
    expect(bindings.every((binding) => binding.conditions?.[0] === 'PORTAL_METRICS_EXTERNAL_HOST')).toBe(true);
  });

  it('defines an opt-in Owner-only Transmission proxy with the accepted RPC Host header', () => {
    const provider = blueprint.entries.find((item) => item.id === 'portal-transmission-provider');
    const mapping = blueprint.entries.find((item) => item.id === 'portal-transmission-host-header');
    const application = blueprint.entries.find((item) => item.id === 'portal-transmission-application');
    const bindings = blueprint.entries.filter((item) =>
      item.model === 'authentik_policies.policybinding' && item.identifiers?.target === 'portal-transmission-application');

    expect(provider?.conditions).toEqual(['PORTAL_TRANSMISSION_EXTERNAL_HOST']);
    expect(provider?.attrs?.internal_host).toBe('http://host.docker.internal:9091');
    expect(provider?.attrs?.external_host).toBe('PORTAL_TRANSMISSION_EXTERNAL_HOST');
    expect(provider?.attrs?.property_mappings).toEqual(['portal-transmission-host-header']);
    expect(mapping?.model).toBe('authentik_providers_oauth2.scopemapping');
    expect(mapping?.attrs?.expression).toContain('127.0.0.1:9091');
    expect(application?.identifiers?.slug).toBe('portal-transmission');
    expect(application?.attrs?.provider).toBe('portal-transmission-provider');
    expect(bindings.map(policyGroupName)).toEqual(['Portal - Owner']);
    expect(bindings.every((binding) => binding.conditions?.[0] === 'PORTAL_TRANSMISSION_EXTERNAL_HOST')).toBe(true);
  });

  it('supplies Transmission RPC Basic credentials only from blank-by-default Owner group attributes', () => {
    const provider = blueprint.entries.find((item) => item.id === 'portal-transmission-provider');
    const ownerGroup = blueprint.entries.find((item) => item.identifiers?.name === 'Portal - Owner' && item.model === 'authentik_core.group');
    const bindings = blueprint.entries.filter((item) =>
      item.model === 'authentik_policies.policybinding' && item.identifiers?.target === 'portal-transmission-application');
    const userKey = provider?.attrs?.basic_auth_user_attribute;
    const passwordKey = provider?.attrs?.basic_auth_password_attribute;
    const ownerAttributes = ownerGroup?.attrs?.attributes as Record<string, unknown> | undefined;

    expect(provider?.attrs?.basic_auth_enabled).toBe(true);
    expect(userKey).toBe('portal_transmission_rpc_username');
    expect(passwordKey).toBe('portal_transmission_rpc_password');
    expect(ownerAttributes?.[userKey as string]).toBe('PORTAL_TRANSMISSION_RPC_USERNAME');
    expect(ownerAttributes?.[passwordKey as string]).toBe('PORTAL_TRANSMISSION_RPC_PASSWORD');
    expect(bindings.map(policyGroupName)).toEqual(['Portal - Owner']);
    for (const name of ['PORTAL_TRANSMISSION_RPC_USERNAME', 'PORTAL_TRANSMISSION_RPC_PASSWORD']) {
      expect(compose).toContain(`${name}: \${${name}:-}`);
      expect(authentikEnvExample).toMatch(new RegExp(`^${name}=$`, 'm'));
      expect(authentikSetup).toContain(`${name}=\\n`);
    }
    const sources = [compose, authentikEnvExample, authentikSetup, readFileSync(resolve(process.cwd(), 'deploy/authentik/README.md'), 'utf8'),
      readFileSync(resolve(process.cwd(), 'deploy/authentik/blueprints/portal-access-groups.yaml'), 'utf8')];
    for (const source of sources) {
      expect(source).not.toMatch(/^[ \t]*PORTAL_TRANSMISSION_RPC_(?:USERNAME|PASSWORD)[ \t]*[=:][ \t]*(?!\$\{)\S/m);
      expect(source).not.toMatch(/^[ \t]*portal_transmission_rpc_(?:username|password):[ \t]*(?!\!Env\b)\S/m);
    }
  });

  it('defines an opt-in Immich OIDC client with email-based auto-registration and Family/Owner access', () => {
    const provider = blueprint.entries.find((item) => item.id === 'portal-immich-oidc-provider');
    const mapping = blueprint.entries.find((item) => item.id === 'portal-immich-profile');
    const application = blueprint.entries.find((item) => item.id === 'portal-immich-oidc-application');
    const bindings = blueprint.entries.filter((item) =>
      item.model === 'authentik_policies.policybinding' && item.identifiers?.target === 'portal-immich-oidc-application');

    expect(provider?.conditions).toEqual([
      'PORTAL_IMMICH_OIDC_CLIENT_SECRET',
      'PORTAL_IMMICH_OIDC_WEB_LOGIN_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_WEB_LINK_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_LAN_LOGIN_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_LAN_LINK_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_MOBILE_CALLBACK_URL',
    ]);
    const redirectUris = provider?.attrs?.redirect_uris as unknown[];
    expect(redirectUris[0]).toEqual([
      'AND',
      'PORTAL_IMMICH_OIDC_HTTPS_LOGIN_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_HTTPS_LINK_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_TAILNET_LOGIN_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_TAILNET_LINK_CALLBACK_URL',
    ]);
    const withHttpsAndTailnet = redirectUris[1] as Array<Record<string, string>>;
    expect(withHttpsAndTailnet).toHaveLength(9);
    expect(withHttpsAndTailnet.slice(5)).toEqual([
      { matching_mode: 'strict', url: 'PORTAL_IMMICH_OIDC_HTTPS_LOGIN_CALLBACK_URL', redirect_uri_type: 'authorization' },
      { matching_mode: 'strict', url: 'PORTAL_IMMICH_OIDC_HTTPS_LINK_CALLBACK_URL', redirect_uri_type: 'authorization' },
      { matching_mode: 'strict', url: 'PORTAL_IMMICH_OIDC_TAILNET_LOGIN_CALLBACK_URL', redirect_uri_type: 'authorization' },
      { matching_mode: 'strict', url: 'PORTAL_IMMICH_OIDC_TAILNET_LINK_CALLBACK_URL', redirect_uri_type: 'authorization' },
    ]);
    expect(withHttpsAndTailnet.every((uri) => uri.matching_mode === 'strict')).toBe(true);

    const withoutTailnetCondition = redirectUris[2] as unknown[];
    expect(withoutTailnetCondition[0]).toEqual([
      'AND',
      'PORTAL_IMMICH_OIDC_HTTPS_LOGIN_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_HTTPS_LINK_CALLBACK_URL',
    ]);
    expect(withoutTailnetCondition[1]).toHaveLength(7);
    const withoutHttpsCondition = withoutTailnetCondition[2] as unknown[];
    expect(withoutHttpsCondition[0]).toEqual([
      'AND',
      'PORTAL_IMMICH_OIDC_TAILNET_LOGIN_CALLBACK_URL',
      'PORTAL_IMMICH_OIDC_TAILNET_LINK_CALLBACK_URL',
    ]);
    const withTailnetCallbacks = withoutHttpsCondition[1] as Array<Record<string, string>>;
    expect(withTailnetCallbacks).toHaveLength(7);
    expect(withTailnetCallbacks.slice(5)).toEqual([
      {
        matching_mode: 'strict',
        url: 'PORTAL_IMMICH_OIDC_TAILNET_LOGIN_CALLBACK_URL',
        redirect_uri_type: 'authorization',
      },
      {
        matching_mode: 'strict',
        url: 'PORTAL_IMMICH_OIDC_TAILNET_LINK_CALLBACK_URL',
        redirect_uri_type: 'authorization',
      },
    ]);
    expect(withTailnetCallbacks.every((uri) => uri.matching_mode === 'strict')).toBe(true);
    expect(withoutHttpsCondition[2]).toHaveLength(5);
    expect(provider?.attrs?.client_type).toBe('confidential');
    expect(provider?.attrs?.grant_types).toEqual(['authorization_code']);
    expect(provider?.attrs?.property_mappings).toEqual([
      ['authentik_providers_oauth2.scopemapping', ['scope_name', 'openid']],
      'portal-immich-profile',
    ]);
    expect(mapping?.attrs?.scope_name).toBe('profile');
    expect(mapping?.attrs?.expression).not.toContain('email');
    expect(mapping?.attrs?.expression).not.toContain('immich_role');
    expect(application?.attrs?.meta_description).toContain('authenticated manual linking');
    expect(application?.identifiers?.slug).toBe('portal-immich-oidc');
    expect(application?.attrs?.provider).toBe('portal-immich-oidc-provider');
    expect(bindings.map(binding => policyGroupName(binding))).toEqual(['Portal - Family', 'Portal - Owner']);
    expect(compose).toContain('PORTAL_IMMICH_OIDC_CLIENT_SECRET');
    expect(compose).toContain('PORTAL_IMMICH_OIDC_TAILNET_LOGIN_CALLBACK_URL');
    expect(compose).toContain('PORTAL_IMMICH_OIDC_HTTPS_LOGIN_CALLBACK_URL');
    expect(authentikEnvExample).toContain('PORTAL_IMMICH_OIDC_MOBILE_CALLBACK_URL');
    expect(authentikEnvExample).toContain('PORTAL_IMMICH_OIDC_TAILNET_LINK_CALLBACK_URL');
    expect(authentikEnvExample).toContain('PORTAL_IMMICH_OIDC_HTTPS_LINK_CALLBACK_URL');
    expect(authentikSetup).toContain('PORTAL_IMMICH_OIDC_TAILNET_LOGIN_CALLBACK_URL=');
    expect(authentikSetup).toContain('PORTAL_IMMICH_OIDC_TAILNET_LINK_CALLBACK_URL=');
  });

  it('defines an opt-in Family and Owner-only Grocy gateway without Public access', () => {
    const provider = blueprint.entries.find((item) => item.id === 'portal-grocy-provider');
    const application = blueprint.entries.find((item) => item.id === 'portal-grocy-application');
    const bindings = blueprint.entries.filter((item) =>
      item.model === 'authentik_policies.policybinding' && item.identifiers?.target === 'portal-grocy-application');

    expect(provider?.conditions).toEqual(['PORTAL_GROCY_EXTERNAL_HOST']);
    expect(provider?.attrs?.internal_host).toBe('PORTAL_GROCY_INTERNAL_HOST');
    expect(provider?.attrs?.external_host).toBe('PORTAL_GROCY_EXTERNAL_HOST');
    expect(provider?.attrs?.mode).toBe('proxy');
    expect(provider?.attrs?.skip_path_regex).toBe('');
    expect(compose).toContain('PORTAL_GROCY_INTERNAL_HOST');
    expect(authentikEnvExample).not.toContain('PORTAL_GROCY_API_KEY_PATH_REGEX=');
    expect(application?.identifiers?.slug).toBe('portal-grocy');
    expect(application?.attrs?.provider).toBe('portal-grocy-provider');
    expect(bindings.map((binding) => binding.identifiers?.order)).toEqual([0, 1]);
    expect(bindings.map(policyGroupName)).toEqual(['Portal - Family', 'Portal - Owner']);
    expect(bindings.every((binding) => binding.conditions?.[0] === 'PORTAL_GROCY_EXTERNAL_HOST')).toBe(true);
    expect(compose).toContain('PORTAL_GROCY_EXTERNAL_HOST');
  });

  it('ships separate Public, Family, and Owner demo routes in its access config', () => {
    expect(portalConfig.services.map((service: { url: string }) => service.url)).toEqual([
      '/sample', '/family-check', '/owner-check',
    ]);
    expect(portalConfig.services.map((service: { accessGroups: string[] }) => service.accessGroups[0])).toEqual([
      'Portal - Public', 'Portal - Family', 'Portal - Owner',
    ]);
  });
});
