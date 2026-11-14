# Local authentik test instance

This Compose project starts an isolated authentik identity provider for development. The web port is bound to `127.0.0.1:9000` only; Compose does not publish it on the LAN or tailnet, and no existing service is placed behind it. A separate Tailscale Serve configuration may expose it privately on a specific machine; review that machine's Serve status and tailnet policy independently. This scaffold is not an authorization boundary until an application/provider is configured and direct service routes are protected.

## Start

From the repository root:

```sh
sh deploy/authentik/setup-local.sh
cd deploy/authentik
docker compose config -q
docker compose pull
docker compose up -d
```

Open `http://127.0.0.1:9000/if/flow/initial-setup/` on the Mac to set the initial `akadmin` password. Use a password manager. Never commit or share `.env`; it contains generated database and signing secrets. The database volume and `data/` persist across container restarts.

Check health and logs:

```sh
docker compose ps
docker compose logs --tail=100 server worker postgresql
```

Stop without deleting persistent data:

```sh
docker compose down
```

Remove the test identity-provider data only when you deliberately want to erase it:

```sh
docker compose down --volumes
```

## Access groups and protected test service

A version-controlled Authentik blueprint at `blueprints/portal-access-groups.yaml` seeds four non-superuser groups: `Portal - Pending`, `Portal - Public`, `Portal - Family`, and `Portal - Owner`. Compose mounts it read-only into the worker. The groups do not contain users by default. New accounts enter Pending; an owner grants Public or Family only after review.

The Compose project builds the protected portal with `VITE_PORTAL_PUBLIC_DEMO=false` and exposes only container port `8080` to the private Docker network; it does not publish the portal directly on the host. A missing or non-JSON `/api/session` response is an error, never a switch to the editable public demo. By default it mounts `portal-services.json.example`. To customize the isolated demo, copy that file to the ignored `deploy/authentik/portal-services.json` and set `PORTAL_CONFIG_FILE=./portal-services.json` in `deploy/authentik/.env`. This configuration contains three same-origin checks: `/sample` (Public), `/family-check` (Family), and `/owner-check` (Owner). The portal server obtains the authenticated identity and group headers from Authentik, filters the service list, and checks protected paths itself; hiding a tile is not the security boundary.

The protected portal's Authentik application accepts members of Public, Family, Owner, or Pending; the upstream then enforces service visibility and protected demo routes. Pending users receive the Atrium only, with no service links and no access to the demo endpoints. Because this blueprint sets the embedded outpost's provider list to this demo provider, keep this an isolated Authentik test instance. Do not apply it to an instance hosting other applications unless you preserve and include its existing provider assignments.

Portal Owner members are assigned a least-privilege Authentik role so they can use the Admin interface to review the **Pending** group and manage membership of **Public** and **Family**. The role has read access to user records, view-only permission on Pending, and object-scoped view/add/remove membership permissions on Public and Family. It does not grant superuser status, user edit/delete, invitation creation, or any ability to add/remove users in Pending or the **Owner** group; the Owner group itself remains controlled by the Authentik administrator. This lets an Owner inspect waiting users and grant/revoke Public or Family access without being able to promote another account to Owner or self-approve by modifying the Pending group.

For the tailnet test route, first inspect existing Serve configuration and confirm the chosen port is unused. A typical command is:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:9000
tailscale serve status
```

Then build/start the portal and reapply the blueprint:

```sh
docker compose up -d --build --force-recreate portal-test worker
docker compose logs --tail=100 portal-test worker
```

Open the configured `PORTAL_TEST_EXTERNAL_HOST`. Create separate non-admin test users in each of the three groups and verify their visible service cards and direct-route behavior: Public should receive 403 from `/family-check` and `/owner-check`; Family should receive 403 from `/owner-check`; Owner should reach all three. Also verify signed-out users are redirected by Authentik and the portal container has no published host port. The authenticated header offers Sign out through `/outpost.goauthentik.io/sign_out`; the static public demo has no account controls. Superusers are not valid tests of group authorization. These demo routes do not protect any real household service.

## Enrollment and invitations

The blueprint creates an invitation flow with a required invitation stage, username/password and profile prompts, and a User Write stage that assigns new accounts only to `Portal - Pending`. It is separate from the default login flow, and no invitation objects are pre-created. The invitation URL shape is `https://<authentik-host>/if/flow/portal-invitation-enrollment/?itoken=<token>`; the token is generated by Authentik and should be sent privately.

To invite someone, sign in to the Authentik Admin interface and open **Directory → Invitations → New Invitation**. Select **Portal invitation enrollment** from the Flow list, create a single-use invitation with a short expiry, save it, and privately share the generated link. Authentik includes the invitation token in that link; sending through Authentik email requires SMTP configuration. Invitees create an internal account and land in Pending, not Public. They see the Atrium only until the owner grants Public or Family membership. Do not use the Owner group for ordinary visitors.

## Google sign-in and pending Atrium

Google sign-in is configured separately because its Client ID and Secret belong in the Authentik source, not in the repository. In the Google OAuth source, set **Enrollment Flow** to **Portal Google pending enrollment** after applying the blueprint. Keep the source's Google email matching and do not map external Google groups into portal groups. This flow creates an external Authentik account in `Portal - Pending` and signs the user in; it does not require an invitation. The default brand redirects external users directly to the Portal application after login, because external accounts cannot use the Authentik user dashboard. Pending membership grants no service access or administrative permissions. Anyone still needs access to the tailnet-only Authentik host to reach sign-in.

The protected portal application permits Pending users to reach the portal, but its backend returns no service cards to a Pending-only account and denies protected demo routes. Real service applications (including Books) must continue to exclude Pending. To approve a person, grant `Portal - Public` or `Portal - Family` membership in Authentik; service access is derived from those groups. The Atrium is not an authorization shortcut, and hiding a tile is not a service boundary.

The Pending group, invitation enrollment flow, Google Pending enrollment flow, and Google source enrollment assignment are applied to the local Authentik instance. A new Google account has not yet completed browser enrollment, so the end-to-end Atrium login still needs that acceptance test. The blueprint configures an in-app Owner notification rule, but delivery is not verified; check **Directory → Groups → Portal - Pending** for awaiting users. SMTP/email is not configured.

## Optional Books/Calibre pilot scaffold

`PORTAL_BOOKS_EXTERNAL_HOST` is empty by default, so the Books proxy provider/application is not created or assigned. If configured later, the blueprint grants access to each of `Portal - Public`, `Portal - Family`, and `Portal - Owner` (any one group is sufficient) and proxies to `http://host.docker.internal:8087`. This is only a scaffold; it does not add a Books tile to the private portal config or change the Calibre LaunchAgent.

Do not activate this pilot until the owner has completed the portal authentication/group tests. Before enabling it, preserve the current `~/Library/LaunchAgents/com.yehor.books-server.plist`, change Calibre's listener to `--listen-on=127.0.0.1` so port 8087 is no longer reachable directly from LAN/tailnet, and verify that only loopback is listening. The Authentik server container was verified to reach both current Calibre and a temporary host-loopback-only test listener via `host.docker.internal`; the real Calibre instance has not been rebound or protected. Calibre's own reverse-proxy guidance also recommends localhost binding. Keep the read-only server flags. The Book provider is designed for a separate tailnet HTTPS URL, e.g. `https://<machine>.ts.net:8444`; first inspect `tailscale serve status`, then only if port 8444 is unused add a Serve HTTPS route to `http://127.0.0.1:9000`. Do not use Funnel or router port forwarding.

Future activation sequence, only after the interactive authorization gate passes:

1. Back up the current Calibre LaunchAgent plist. Change `--listen-on=0.0.0.0` to `--listen-on=127.0.0.1`, restart it, and verify Calibre still serves on loopback while `lsof` shows no all-interface `:8087` listener.
2. Set `PORTAL_BOOKS_EXTERNAL_HOST=https://<machine>.ts.net:8444` in the ignored `deploy/authentik/.env`; add the Books card with that URL and `accessGroups: ["Portal - Public"]` to the ignored local portal config. Do not put the machine URL in the generic example or public repo.
3. After checking that `:8444` is unused, add the tailnet-only Tailscale Serve route and verify it with `tailscale serve status`. Then from `deploy/authentik/` run:

   ```sh
   tailscale serve --bg --https=8444 http://127.0.0.1:9000
   tailscale serve status
   docker compose up -d --force-recreate worker
   docker compose exec -T worker ak apply_blueprint /blueprints/portal-access-groups.yaml
   ```

4. Verify a signed-out request redirects to Authentik, an approved household account can browse/download, an ungranted account is denied, and the former direct LAN/tailnet `:8087` route fails. Test FBReader/Apple Books OPDS/download behavior before considering the pilot complete.

Rollback: remove the `:8444` Serve route, blank `PORTAL_BOOKS_EXTERNAL_HOST`, recreate the worker and reapply the blueprint so the outpost drops the Books provider, then restore the saved LaunchAgent plist and verify the previous `:8087` behavior. The blueprint does not delete the now-unassigned Books application/provider records; remove those only after confirming they are no longer assigned to the outpost.

The URL to open in a browser is not automatically usable by native OPDS clients: Authentik's interactive sign-in may not be supported by FBReader or Apple Books. Test browsing, download, OPDS feeds, and client sign-in before calling the pilot complete. If a native client cannot authenticate, do not restore an unauthenticated network listener as a workaround; keep the pilot disabled and choose a compatible access design. Setting the external-host variable without closing the old direct route does **not** enforce Authentik.

To run the repeat-apply/membership regression check against this dedicated test instance, start the stack and run from the repository root:

```sh
npm run test:authentik-runtime -- --confirm-test-stack
```

The check reapplies the blueprint twice, creates and removes a random disabled Owner-role test account, and verifies membership plus provider/application/outpost/policy wiring and the local notification rule targeting `authentik Admins`. It does not prove delivery from a completed enrollment flow or remote phone access; those still need a real client. Local Authentik notifications appear in-app; SMTP/email is not configured.

## Optional Audiobookshelf gateway

`PORTAL_AUDIOBOOKSHELF_EXTERNAL_HOST` is empty by default. When configured, the blueprint creates an Authentik proxy application for the loopback Audiobookshelf upstream at `http://host.docker.internal:13378`, grants it to Public, Family, and Owner, and assigns it to the embedded outpost. The household-specific Tailscale HTTPS URL belongs only in the ignored `.env` and private portal service config, never in this repository.

This gateway adds Authentik authorization before the Audiobookshelf web app; it does not replace Audiobookshelf's own local login, so a browser may see both gates. Native clients may not follow the gateway's browser redirect. Keep the existing tailnet TCP route on `:13378` until the chosen phone/client behavior is checked, and do not call the migration complete while an unprotected route remains. Do not alter the library, user database, or local-auth configuration as part of enabling the gateway.

Before enabling, verify that the Authentik server container can reach the loopback-bound upstream, inspect existing Serve configuration, and ensure the separate HTTPS route is tailnet-only. An upstream HTTP 200 does not prove phone reachability or client compatibility.

## Optional owner-only metrics gateway

`PORTAL_METRICS_EXTERNAL_HOST` is empty by default. When configured, the blueprint adds an Authentik proxy provider for the read-only metrics API at `http://host.docker.internal:8086`, grants the application only to `Portal - Owner`, and assigns it to the embedded outpost. A provider property mapping forwards the configured external hostname as the upstream `Host` header because the metrics API rejects unknown hostnames. Keep the household HTTPS URL in the ignored `.env` and private portal configuration only.

This does not change the metrics API listener or the legacy dashboard. The existing dashboard still calls port `8086` directly, so keep that listener unchanged until the dashboard is migrated and the owner accepts the replacement. The protected route is additive; the direct API remains a bypass during this staged phase.

To show the status inline on the authenticated portal, add `"widget": "system-status"` to the Owner-only metrics service in the ignored `portal-services.json`. Set `PORTAL_STATUS_UPSTREAM_URL` in the ignored `.env` to the private API URL reachable from the portal container (for example, a local `host.docker.internal` URL). The Compose service derives the required upstream Host header from `PORTAL_METRICS_EXTERNAL_HOST`; neither value is sent to the browser. The portal's `/api/system-status` route independently requires `Portal - Owner`, validates the returned metrics, and returns no-store JSON to that Owner-only widget. The public `.env.example` leaves this feature disabled by default.

## Not configured yet

- Google OAuth source/client credentials and sign-in flow
- Email delivery for owner notifications (the in-app Authentik notification is configured; SMTP is not)
- Invitation-only enrollment flow is configured and applied, but not browser-tested; no invitations are pre-created
- User membership or grants for real household services
- Books/Calibre provider scaffold is opt-in only; it is not enabled and the direct-port bypass remains open
- Reverse-proxy protection of existing services and direct-port bypass closure

When exposing through Tailscale Serve, inspect the tailnet access policy and Serve status first; keep the service tailnet-only. Google redirect URI will be `https://<chosen-authentik-hostname>/source/oauth/callback/google/` when the authentik source slug is `google`; register the exact final hostname in Google Cloud. Keep the client secret in authentik's source configuration, not this repository or chat.

The upstream authentik Docker Compose installation guidance requires at least 2 CPU cores and 2 GB RAM. The test deployment pins the image version in `compose.yml`; update it deliberately, back up the database, and consult authentik's upgrade instructions before upgrading.
