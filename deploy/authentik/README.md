# Local authentik test instance

This Compose project starts an isolated authentik identity provider for development. The web port is bound to `127.0.0.1:9000` only; Compose does not publish it on the LAN or tailnet, and no existing service is placed behind it. This does not isolate it from Docker Desktop peers, which may reach loopback publications through the host gateway. A separate Tailscale Serve configuration may expose it privately on a specific machine; review that machine's Serve status and tailnet policy independently. This scaffold is not an authorization boundary until an application/provider is configured and direct service routes are protected.

## Portal live panels and app recommendations

The private portal shows the existing Owner-only Mac status panel above the service tiles, with a 15-second refresh while visible. Transmission's Owner-only tile shows running/total counts, byte-weighted completion, and download/upload rates; its expansion button mounts the existing protected HTTPS web UI in a sandboxed iframe and removes it on collapse. First-time sign-in may require opening the full-page link before reloading the panel. Portal CSP permits framing only that configured HTTPS origin, and only on Owner responses.

`GET /api/transmission-status` checks the verified portal identity before contacting RPC and returns only numeric aggregates, never torrent names, paths, credentials or session headers. The backend uses the existing `PORTAL_TRANSMISSION_RPC_USERNAME`/`PORTAL_TRANSMISSION_RPC_PASSWORD` environment references; do not place those values in frontend config. No raw RPC or control proxy is added. Anonymous gets 401; Public, Family and Pending get 403. Status responses are `no-store`.

App recommendations and setup instructions are configured in each private service entry's optional `guides` field. The backend validates these fields and returns them only after the parent service's existing group filtering. Public users therefore receive only their service guides, Family also receives household guides, and Owner also receives system and Transmission guides. Pending receives none. The iPhone/iPad–Android switch defaults to detected platform and affects guides only; it does not change app-launch links or permissions. Download links use `noreferrer`; copyable service addresses remain separate from external links.

Example service field (illustrative public address):

```json
"guides": {
  "ios": {
    "title": "AudioBooth",
    "downloadUrl": "https://apps.apple.com/app/id6753017503",
    "connectionLabel": "Server address",
    "connectionUrl": "https://audio.example.test:8448/",
    "steps": ["Add a server with the address below.", "Choose SSO and complete sign-in."]
  }
}
```

Supported platform keys are `ios` and `android`. Each guide requires `title` and a nonempty `steps` list; `downloadUrl`, `connectionUrl` and `connectionLabel` are optional. URLs must be credential-free HTTPS. Unknown fields are rejected. Keep credentials, API keys and tokens out of all guide text and URLs. Set the guide's connection address deliberately: Books uses its OPDS URL; native Audiobookshelf uses the unified `:8448` address. To apply metadata-only changes, validate the config and recreate only `portal-test`; no frontend rebuild is needed.

The compact header's route indicator reads the edge-generated `X-Portal-Connection` response header on the session request: green for `local`, blue for `tailscale`, neutral if unavailable. It reports the path used to load the portal, not whether a VPN app is installed, and is not an authorization signal. The LAN Caddy path stamps `local`; the tailnet portal/auth Serve routes use a loopback-only Caddy relay on `9082`, which stamps `tailscale`, preserves the public Host and original forwarded-for metadata, and forwards HTTPS scheme metadata to the same existing Authentik upstream. Other service routes and tailnet access policy remain unchanged.

After a build, `npm run test:portal-server` includes owner-gating, aggregate privacy and offline-worker tests. These same-host checks do not replace a real authenticated device iframe/login test.

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

Do not activate this pilot until the portal authentication/group tests pass. Back up the existing Calibre service configuration, bind Calibre to loopback so its direct LAN/tailnet listener is closed, and verify the change before enabling the proxy. Confirm the Authentik server can reach the upstream through an explicitly configured private network path; do not assume host-gateway access is isolated. Keep Calibre's read-only server flags. Configure the Book provider with a dedicated HTTPS URL in the ignored local `.env` (for example, `https://<machine>.ts.net:8444`); inspect existing Tailscale Serve routes and confirm the port is unused before adding a route to the local Authentik proxy. Do not use Funnel or router port forwarding.

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

## Optional Audiobookshelf native OIDC

Set `PORTAL_AUDIOBOOKSHELF_OIDC_CLIENT_SECRET`, `PORTAL_AUDIOBOOKSHELF_OIDC_WEB_CALLBACK_URL`, `PORTAL_AUDIOBOOKSHELF_OIDC_MOBILE_CALLBACK_URL`, and `PORTAL_AUDIOBOOKSHELF_OIDC_LOGOUT_CALLBACK_URL` in the ignored `.env` to create a confidential, per-provider OIDC client. Register the exact web and mobile callback URLs produced by Audiobookshelf's **Subfolder for Redirect URLs** setting as strict Authorization URIs. Register the exact ABS login route as a **Post Logout** URI (commonly `/audiobookshelf/login` when `RouterBasePath` is `/audiobookshelf`). If a browser reaches ABS through a separate Authentik-protected gateway origin, optionally set `PORTAL_AUDIOBOOKSHELF_OIDC_GATEWAY_CALLBACK_URL` to that origin's exact callback URL; it is added as a second strict Authorization URI while the direct web and mobile callbacks remain unchanged. Leave it blank when no second browser origin is used. Do not use wildcard matching. The native app's own redirect remains `audiobookshelf://oauth`; Audiobookshelf receives the provider callback first and then redirects to the app.

The OIDC application is hidden from the launcher and grants authorization only to `Portal - Public`, `Portal - Family`, or `Portal - Owner`; Pending users receive no access. A provider-scoped `profile` mapping returns the user's Authentik username by default, or the `audiobookshelf_username` user attribute when an existing Audiobookshelf account uses a different username. Configure Audiobookshelf to match existing users by username, leave auto-registration disabled, and keep local sign-in enabled for recovery. Create/link each person's local Audiobookshelf account before granting OIDC access. Clearing the environment variables prevents future blueprint creation but does not delete provider/application records already created; remove those explicitly when disabling an existing deployment.

## Optional owner-only metrics gateway

`PORTAL_METRICS_EXTERNAL_HOST` is empty by default. When configured, the blueprint adds an Authentik proxy provider for the read-only metrics API at `http://host.docker.internal:8086`, grants the application only to `Portal - Owner`, and assigns it to the embedded outpost. A provider property mapping forwards the configured external hostname as the upstream `Host` header because the metrics API rejects unknown hostnames. Keep the household HTTPS URL in the ignored `.env` and private portal configuration only.

This does not change the metrics API listener or the legacy dashboard. The existing dashboard still calls port `8086` directly, so keep that listener unchanged until the dashboard is migrated and the owner accepts the replacement. The protected route is additive; the direct API remains a bypass during this staged phase.

## Optional Owner-only Transmission gateway

`PORTAL_TRANSMISSION_EXTERNAL_HOST` is empty by default. When set to the HTTPS origin for a tailnet-only Tailscale Serve route, the blueprint creates an Authentik proxy to `http://host.docker.internal:9091`, exposes the Transmission Web UI, and binds the application only to `Portal - Owner`. The provider mapping sets the upstream `Host` to `127.0.0.1:9091`, which is accepted by the default local Transmission RPC configuration; adjust that mapping if the upstream instance uses a different accepted RPC Host value. Keep the protected route tailnet-only and do not use Funnel.

This is a staged replacement route, not a completed cutover: it does not close Transmission's direct route or change the legacy dashboard, which embeds full-control Transmission UI. Preserve both until the protected UI and API/RPC actions are verified by the Owner, then separately plan the dashboard replacement and direct-route closure. The route requires Authentik authorization in addition to Tailscale reachability.

### Transmission RPC authentication

Transmission's loopback binding alone is not a boundary: Docker Desktop containers can reach host loopback. The provider therefore sets `basic_auth_enabled: true` and sends upstream HTTP Basic credentials read from `portal_transmission_rpc_username` and `portal_transmission_rpc_password`. The blueprint sources them from blank-by-default `PORTAL_TRANSMISSION_RPC_USERNAME` and `PORTAL_TRANSMISSION_RPC_PASSWORD` values on the `Portal - Owner` group. Authentik falls back to the user's email and an empty password when the configured attributes are absent; Transmission rejects the request only after its own `rpc-authentication-required` setting is enabled. The blueprint does not change that daemon setting, so until rollout step 4 the upstream remains unauthenticated. Do not disable Transmission RPC auth or remove the Owner-only binding to work around this. The blueprint manages the Owner group's whole `attributes` field, so inspect its existing keys before applying; a same-named user attribute takes precedence over a group attribute, so do not set these keys on individual users. Authentik administrators can read these attributes.

Rollout (requires a brief Transmission restart):

1. Generate a strong, private RPC username and password using a password manager. Never commit or paste them into docs, tickets, logs, or chat.
2. Set them in the ignored `deploy/authentik/.env`, recreate the worker, and reapply the blueprint.
3. Verify without printing values that the provider has Basic auth enabled with both attribute names and that both Owner-group attributes are present and non-empty.
4. Back up Transmission's current settings with restrictive permissions and record the rollback before changing them. Set the same credentials with `rpc-authentication-required: true` in Transmission's settings, then restart Transmission. Keep the existing loopback bind, Host whitelist, and `127.0.0.1:9091` Host-header mapping unchanged.
5. Start a fresh Owner proxy session and verify the Web UI/RPC actions work. From a throwaway container, request `http://host.docker.internal:9091/transmission/rpc` without Basic auth; it must return `401`. A non-Owner must still be denied by Authentik.

Rollback: restore the saved Transmission settings (keeping RPC auth required whenever possible) and restart. Blank the two variables or set `basic_auth_enabled: false`, then reapply the blueprint. Disabling Transmission RPC auth reopens the container-origin exposure; only do so briefly and deliberately.

To show the status inline on the authenticated portal, add `"widget": "system-status"` to the Owner-only metrics service in the ignored `portal-services.json`. Set `PORTAL_STATUS_UPSTREAM_URL` in the ignored `.env` to the private API URL reachable from the portal container (for example, a local `host.docker.internal` URL). The Compose service derives the required upstream Host header from `PORTAL_METRICS_EXTERNAL_HOST`; neither value is sent to the browser. The portal's `/api/system-status` route independently requires `Portal - Owner`, validates the returned metrics, and returns no-store JSON to that Owner-only widget. The public `.env.example` leaves this feature disabled by default.

## Optional Immich native OIDC (email-based account creation)

Set `PORTAL_IMMICH_OIDC_CLIENT_SECRET` plus the five exact base callback variables in the ignored `.env` to create a confidential Authentik OIDC client. The provider grants access only to `Portal - Family` and `Portal - Owner`; Public/Pending are excluded. It requests `openid`, `profile`, and Authentik's standard `email` mapping so Immich receives the email required for first-time account creation.

Register strict Authorization URIs from every exact Immich origin in use: `/auth/login` for normal web OAuth and `/user-settings` for account linking, plus `app.immich:///oauth-callback` for Android/iOS. To add a tailnet/LAN hostname without removing working origins, set both optional `PORTAL_IMMICH_OIDC_TAILNET_LOGIN_CALLBACK_URL` and `PORTAL_IMMICH_OIDC_TAILNET_LINK_CALLBACK_URL`; the blueprint adds both strictly only when both are present. For a separate HTTPS reverse-proxy origin, set both optional `PORTAL_IMMICH_OIDC_HTTPS_LOGIN_CALLBACK_URL` and `PORTAL_IMMICH_OIDC_HTTPS_LINK_CALLBACK_URL`; both are added strictly only when both are present, and existing callbacks remain registered. Configure exact callbacks for every origin you intend to use; never commit household URLs. In Immich, use client ID `immich-oidc`, the Authentik provider issuer, scopes `openid profile email`, and Auto Register on.

**Account-linking behavior:** Immich v3.4.1 first tries to match an unlinked local account by the OIDC email, even when Auto Register is off, and does not require `email_verified` for that match. If no account matches, Auto Register creates a regular Immich user. The Authentik provider is limited to Family/Owner and issues no `immich_role` claim, so new users are not made Immich admins by this setup. Email matches can link existing Immich accounts. The example invitation flow collects an email address but does not verify ownership; do not enable email-based matching until a trusted email-verification process is configured before granting Family or Owner access. For manual-link-only deployments, do not request the email scope, leave Auto Register off, and verify that no email claim is returned. Preserve Immich's existing routes until browser, Android, and iPhone sign-in and account-creation behavior are verified.

No `immich_role` claim is issued; never add an `admin` role for Family. When the portal deployment configures its default Authentik brand, the blueprint also assigns the existing default authentication flow as the brand's User switch flow. This enables Authentik account switching; it does not change group membership or service authorization.

## Optional Family and Owner Grocy gateway

`PORTAL_GROCY_EXTERNAL_HOST` is empty by default. When configured, the blueprint creates a proxy application bound only to `Portal - Family` and `Portal - Owner`; Public and Pending receive no grant. `PORTAL_GROCY_INTERNAL_HOST` defaults to `http://grocy:80` in Compose and is passed to the blueprint through the worker. Keep household URLs in the ignored `.env` and private portal config.

**Network boundary warning.** A service bound to host loopback may still be reachable by Docker Desktop peer containers through the host gateway. Header scrubbing protects only requests that traverse the configured ingress; it does not isolate a directly reachable upstream or Authentik outpost. Verify the effective container topology and every direct route before treating the proxy as an authorization boundary.

### Required private upstream boundary (opt-in overlay)

[compose.grocy.yml](compose.grocy.yml) adds a dedicated user-defined, internal network. Only `server` (the embedded Authentik outpost) and `grocy` join `grocy_private`. Grocy has **no host-published ports**, no host networking, and no default-network attachment. The server retains its default network for Authentik dependencies and resolves the private service alias `grocy`. The worker, portal, database, and unrelated containers are not private-network members. Base deployments using only `compose.yml` do not start Grocy or create this network. Because `grocy_private` is internal, Grocy has no direct external network route; verify any egress-dependent integrations before use.

For deployment, use a pinned image digest compatible with the existing `/config` and container port 80, and preserve the current Grocy `PUID`, `PGID`, and timezone. In the ignored `.env`, set `GROCY_IMAGE`, `GROCY_CONFIG_PATH`, `GROCY_PUID`, `GROCY_PGID`, `GROCY_TZ`, and the chosen `PORTAL_GROCY_EXTERNAL_HOST`. Back up and deliberately migrate the existing config directory; do not start two Grocy containers against one writable database. Leave `PORTAL_GROCY_INTERNAL_HOST=http://grocy:80`. Render/review before starting:

```sh
cd deploy/authentik
docker compose -f compose.yml -f compose.grocy.yml config --quiet
# Only after deployment authorization and configuration review:
docker compose -f compose.yml -f compose.grocy.yml up -d
```

This overlay defines a new service; it does not modify an existing Grocy container or migrate data. Do not combine it with another Grocy service definition containing `ports`: Compose merging can retain those publications. Remove the old publication/container route as a separately planned cutover, including the old port 9283, IPv4/IPv6 listeners, alternate proxies, and Serve routes. Check the effective deployment for zero Grocy publications. Do not attach other containers to the private network. A private Docker network does not protect against a Docker administrator, privileged/host-network containers, a compromised outpost, or host access.

Grocy's own login remains a second step by default. If choosing `ReverseProxyAuthMiddleware`, explicitly configure least-privilege `DEFAULT_PERMISSIONS` and a safe identity mapping before first use; it can create users automatically. Keep Grocy authentication enabled.

### Ingress scrubbing remains defense in depth

Use [Caddyfile.grocy.example](Caddyfile.grocy.example) for both paths:

```text
LAN HTTPS -> Caddy LAN site ------------------+-> Authentik server/outpost -> http://grocy:80
Tailnet HTTPS -> Serve -> Caddy 127.0.0.1:9080 -+      |                         |
                                              grocy_private network members only
```

Caddy deletes the entire client `X-Authentik-*` request-header namespace before Authentik on every path, preserving session cookies and `GROCY-API-KEY`. Authentik can then add verified identity downstream. Do not scrub between the outpost and Grocy. Both Caddy routes target Authentik, never Grocy. Set `GROCY_LAN_ADDRESS` with DNS and a trusted certificate; set `GROCY_PUBLIC_AUTHORITY` to the host and optional port of `PORTAL_GROCY_EXTERNAL_HOST` without scheme/path. Both ingress paths use this canonical HTTPS origin, which must be reachable along with the Authentik login origin.

`GROCY_OUTPOST_UPSTREAM` defaults to `127.0.0.1:9000`. Keep the Caddy Serve listener bound to `127.0.0.1`; after reviewing existing Serve state, the operator command shape is `tailscale serve --bg --https=<chosen-https-port> http://127.0.0.1:9080`. **Serve must target its loopback Caddy listener, never the outpost directly.** Keep it tailnet-only; do not enable Funnel. This route change does not prevent Docker peers reaching the published outpost directly.

### API skip and native clients remain disabled/pending

The Grocy provider hardcodes `skip_path_regex: ""` for every path. The old `PORTAL_GROCY_API_KEY_PATH_REGEX` environment variable no longer enables a skip. Apply the updated blueprint and verify the stored provider has an empty skip regex; editing files or removing an environment variable does not clear an already configured live bypass.

**The API skip must remain disabled until a separately validated API-key-only gateway is designed and tested.** That gateway must strip all client identity headers and require valid per-device API keys on every API request, with no direct Grocy or skipped-outpost route around it, including Docker peers and host-gateway paths. It must also account for identity headers synthesized by authenticated proxy sessions. Merely enabling `^/api/` after installing the Caddy template is unsafe. Do not disable Grocy authentication or restore a published port as a workaround.

Native Grocy clients may not support Authentik redirects. Do not assume API-key compatibility; keep the API skip disabled until a per-device API-key gateway is designed, reviewed, and tested against the exact client and current Grocy version. A 401 or 500 response alone does not prove the intended access policy.

### Deployment validation and limits

Run `npm run test:grocy-proxy-config` and `npm run test:grocy-proxy` in a disposable checkout with Caddy available (`CADDY_BIN` can select it). The config checks reject the old upstream and host-published Grocy overlay and model a non-member having no host-gateway route. The HTTP suite runs real isolated Caddy against fixture outpost/Grocy servers; it demonstrates the direct-outpost bypass with a hypothetical skip, default no-skip denial, and scrubbing on both ingress paths. These are not live Docker networking or installed Authentik/Grocy tests.

Before claiming a completed deployment, verify effective Compose networks and published ports, upstream reachability, and denial through every alternate route, including service aliases and host-gateway paths. Check that forged identity headers still require authentication; verify both ingress paths, signed-out denial, allowed groups, and denied groups. Audit direct routes and Serve targets without logging credentials. Fixture tests do not establish live Docker isolation, provider state, host listeners, Grocy middleware behavior, migration safety, or native-client compatibility.

## Not configured yet

- Google OAuth source/client credentials and sign-in flow
- Email delivery for owner notifications (the in-app Authentik notification is configured; SMTP is not)
- Invitation-only enrollment flow is configured and applied, but not browser-tested; no invitations are pre-created
- User membership or grants for real household services
- Books/Calibre provider scaffold is opt-in only; it is not enabled and the direct-port bypass remains open
- Audiobookshelf native OIDC is opt-in and requires site-specific callback URLs plus a matching local user for each person
- Reverse-proxy protection of existing services and direct-port bypass closure

When exposing through Tailscale Serve, inspect the tailnet access policy and Serve status first; keep the service tailnet-only. Google redirect URI will be `https://<chosen-authentik-hostname>/source/oauth/callback/google/` when the authentik source slug is `google`; register the exact final hostname in Google Cloud. Keep the client secret in authentik's source configuration, not this repository or chat.

The upstream authentik Docker Compose installation guidance requires at least 2 CPU cores and 2 GB RAM. The test deployment pins the image version in `compose.yml`; update it deliberately, back up the database, and consult authentik's upgrade instructions before upgrading.
