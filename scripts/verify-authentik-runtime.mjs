import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildOptionalProviderVerification } from './authentik-runtime-optional-providers.mjs';

const confirmation = '--confirm-test-stack';
if (!process.argv.includes(confirmation)) {
  throw new Error(`Refusing to modify Authentik without ${confirmation}. This check creates and removes a temporary inactive test user.`);
}

const projectDir = resolve(process.cwd(), 'deploy/authentik');
const composeFile = resolve(projectDir, 'compose.yml');
const username = `portal-blueprint-test-${randomBytes(6).toString('hex')}`;

function runCompose(args, label) {
  const result = spawnSync(
    'docker',
    ['compose', '--project-directory', projectDir, '-f', composeFile, ...args],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    const diagnostics = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
      .split('\n')
      .slice(-20)
      .join('\n');
    throw new Error(`${label} failed (exit ${result.status ?? 'unknown'}). Check that the dedicated Authentik test stack is running.${diagnostics ? `\n${diagnostics}` : ''}`);
  }
  return result.stdout;
}

function runAuthentikShell(source, label) {
  return runCompose(['exec', '-T', 'worker', 'ak', 'shell', '-c', source], label);
}

const createTestUser = `
from authentik.core.models import User, Group
username = '${username}'
user = User.objects.create_user(
    username=username,
    email='portal-blueprint-test@example.invalid',
    password=None,
    name='Temporary Blueprint Integration Test',
    first_name='Temporary',
    last_name='Integration Test',
    is_active=True,
)
Group.objects.get(name='Portal - Owner').users.add(user)
assert user.is_superuser is False
assert user.groups.filter(name='Portal - Owner').exists()
print('TEMPORARY_OWNER_GROUP_MEMBERSHIP_CREATED')
`;

const verifyAfterReapply = `
from authentik.brands.models import Brand
from authentik.core.models import Application, Group, User
from authentik.flows.models import Flow, FlowStageBinding
from authentik.outposts.models import Outpost
from authentik.policies.models import PolicyBinding
from authentik.providers.proxy.models import ProxyProvider
from authentik.rbac.models import Role
from authentik.stages.invitation.models import Invitation, InvitationStage
from authentik.stages.user_write.models import UserWriteStage
from authentik.events.models import EventAction, NotificationRule
from authentik.policies.event_matcher.models import EventMatcherPolicy
from authentik.sources.oauth.models import OAuthSource
from authentik.stages.identification.models import IdentificationStage
import os
${buildOptionalProviderVerification()}

portal_groups = Group.objects.filter(name__in=['Portal - Public', 'Portal - Family', 'Portal - Owner', 'Portal - Pending'])
assert portal_groups.count() == 4
assert not portal_groups.filter(is_superuser=True).exists()

access_role = Role.objects.get(name='Portal Access Managers')
owner_group = Group.objects.get(name='Portal - Owner')
public_group = Group.objects.get(name='Portal - Public')
family_group = Group.objects.get(name='Portal - Family')
pending_group = Group.objects.get(name='Portal - Pending')
assert owner_group.roles.filter(pk=access_role.pk).exists()
global_permissions = set(access_role.rolemodelpermission_set.values_list(
    'permission__content_type__app_label', 'permission__codename'
))
assert global_permissions == {
    ('authentik_rbac', 'access_admin_interface'),
    ('authentik_core', 'view_user'),
}
object_permissions = set(access_role.roleobjectpermission_set.values_list(
    'permission__content_type__app_label',
    'permission__codename',
    'object_pk',
))
expected_object_permissions = {
    ('authentik_core', permission, str(group.pk))
    for group in (public_group, family_group)
    for permission in ('view_group', 'add_user_to_group', 'remove_user_from_group')
} | {('authentik_core', 'view_group', str(pending_group.pk))}
assert object_permissions == expected_object_permissions
assert str(owner_group.pk) not in {entry[2] for entry in object_permissions}

flow = Flow.objects.get(slug='portal-invitation-enrollment')
assert flow.designation == 'enrollment'
assert flow.authentication == 'require_unauthenticated'
invitation_stage = InvitationStage.objects.get(name='Portal invitation required')
assert invitation_stage.continue_flow_without_invitation is False
user_write_stage = UserWriteStage.objects.get(name='Portal enrollment user write')
assert user_write_stage.create_users_group.name == 'Portal - Pending'
assert user_write_stage.user_type == 'internal'
assert Invitation.objects.filter(flow=flow).count() == 0
assert list(
    FlowStageBinding.objects.filter(target=flow).order_by('order').values_list('order', flat=True)
) == [5, 10, 15, 20, 100]

google_pending_flow = Flow.objects.get(slug='portal-google-pending-enrollment')
assert google_pending_flow.designation == 'enrollment'
assert google_pending_flow.authentication == 'none'
google_pending_write = UserWriteStage.objects.get(name='Portal Google pending user write')
assert google_pending_write.user_creation_mode == 'always_create'
assert google_pending_write.user_type == 'external'
assert google_pending_write.create_users_group.name == 'Portal - Pending'
assert list(
    FlowStageBinding.objects.filter(target=google_pending_flow).order_by('order').values_list('order', flat=True)
) == [0, 1, 2]
assert not FlowStageBinding.objects.filter(target=google_pending_flow, stage__name='Portal invitation required').exists()
google_source = OAuthSource.objects.filter(slug='google').first()
if google_source:
    assert google_source.enrollment_flow_id == google_pending_flow.pk
identification_stage = IdentificationStage.objects.get(name='default-authentication-identification')
assert identification_stage.enrollment_flow_id is None

event_matcher = EventMatcherPolicy.objects.get(name='Portal invitation account creation event')
assert event_matcher.action == EventAction.USER_WRITE
notification_rule = NotificationRule.objects.get(name='Portal new account owner notification')
assert notification_rule.destination_group.name == 'authentik Admins'
assert notification_rule.destination_event_user is False
assert list(notification_rule.transports.values_list('name', flat=True)) == ['default-local-transport']
assert PolicyBinding.objects.filter(
    target=notification_rule,
    policy=event_matcher,
    enabled=True,
    negate=False,
).exists()

user = User.objects.get(username='${username}')
assert not user.is_superuser
assert user.groups.filter(name='Portal - Owner').exists()
assert user.has_perm('authentik_rbac.access_admin_interface')
assert user.has_perm('authentik_core.view_user')
for managed_group in (public_group, family_group):
    assert user.has_perm('authentik_core.view_group', managed_group)
    assert user.has_perm('authentik_core.add_user_to_group', managed_group)
    assert user.has_perm('authentik_core.remove_user_from_group', managed_group)
assert user.has_perm('authentik_core.view_group', pending_group)
assert not user.has_perm('authentik_core.add_user_to_group', pending_group)
assert not user.has_perm('authentik_core.remove_user_from_group', pending_group)
assert not user.has_perm('authentik_core.add_user_to_group', owner_group)
assert not user.has_perm('authentik_core.remove_user_from_group', owner_group)

application = Application.objects.get(slug='portal-test')
default_brand = Brand.objects.get(default=True)
if os.environ.get('PORTAL_TEST_EXTERNAL_HOST'):
    assert default_brand.default_application_id == application.pk
provider = ProxyProvider.objects.get(name='Portal Test Protected Service Provider')
assert ProxyProvider.objects.filter(name='Portal Test Protected Service Provider').count() == 1
assert application.provider.pk == provider.pk

outpost = Outpost.objects.get(name='authentik Embedded Outpost')
assert Outpost.objects.filter(name='authentik Embedded Outpost').count() == 1
portal_test_provider_names = {'Portal Test Protected Service Provider'} if os.environ.get('PORTAL_TEST_EXTERNAL_HOST') else set()
assert outpost.providers.filter(pk=application.provider.pk).count() == 1
portal_verify_optional_providers(outpost, portal_test_provider_names)

bindings = PolicyBinding.objects.filter(
    target=application,
    enabled=True,
    negate=False,
    group__name__in=['Portal - Public', 'Portal - Family', 'Portal - Owner', 'Portal - Pending'],
).order_by('order')
assert list(bindings.values_list('order', 'group__name')) == [
    (0, 'Portal - Public'),
    (1, 'Portal - Family'),
    (2, 'Portal - Owner'),
    (3, 'Portal - Pending'),
]
print('GROUPS_PROVIDER_APPLICATION_OUTPOST_POLICIES_MEMBERSHIP_AND_ADMIN_NOTIFICATION_RULE_CONFIGURED')
`;

const deleteTestUser = `
from authentik.core.models import User
User.objects.filter(username='${username}').delete()
print('TEMPORARY_TEST_USER_REMOVED')
`;

let setupAttempted = false;
let primaryError;
try {
  setupAttempted = true;
  runAuthentikShell(createTestUser, 'Temporary test-user setup');
  runCompose(['run', '--rm', '--no-deps', 'worker', 'apply_blueprint', '/blueprints/portal-access-groups.yaml'], 'First blueprint reapplication');
  runCompose(['run', '--rm', '--no-deps', 'worker', 'apply_blueprint', '/blueprints/portal-access-groups.yaml'], 'Second blueprint reapplication');
  const result = runAuthentikShell(verifyAfterReapply, 'Post-reapplication verification');
  assert.match(result, /GROUPS_PROVIDER_APPLICATION_OUTPOST_POLICIES_MEMBERSHIP_AND_ADMIN_NOTIFICATION_RULE_CONFIGURED/);
  console.log('Authentik runtime integration passed: Pending Atrium access, source-scoped Google enrollment with external-user default-app redirect and default enrollment closed, invitation enrollment, Owner review-only Pending access plus Public/Family group grants, Authentik Admins notification rule configuration, repeated blueprint application, provider/application/outpost policies, fail-closed enabled/disabled checks for every optional provider (Books, Audiobookshelf, Metrics, Transmission, Grocy, Audiobookshelf OIDC, Immich OIDC), and membership preservation.');
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  if (setupAttempted) {
    try {
      runAuthentikShell(deleteTestUser, 'Temporary test-user cleanup');
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
    }
  }
}
