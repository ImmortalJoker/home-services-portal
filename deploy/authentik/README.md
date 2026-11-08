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

## Access group bootstrap

A version-controlled Authentik blueprint at `blueprints/portal-access-groups.yaml` seeds three non-superuser groups: `Portal - Public`, `Portal - Family`, and `Portal - Owner`. Compose mounts that file read-only into the worker. The groups do not contain users and are not bound to any application; this is only a safe starting point for later authorization setup. Do not treat membership or hidden application tiles as service protection.

To apply or reapply the blueprint after editing it, restart the worker:

```sh
docker compose up -d --force-recreate worker
docker compose logs --tail=100 worker
```

The worker should report applying the blueprint. Check the groups in the Authentik admin UI under **Directory → Groups**. Review any blueprint changes before applying them; changing this file can update the corresponding Authentik objects.

## Not configured yet

- Google OAuth source/client credentials and sign-in flow
- Application providers/bindings and protected service routes
- Invitation/approval enrollment and owner notifications
- Any user membership in the seeded groups

When exposing through Tailscale Serve, inspect the tailnet access policy and Serve status first; keep the service tailnet-only. Google redirect URI will be `https://<chosen-authentik-hostname>/source/oauth/callback/google/` when the authentik source slug is `google`; register the exact final hostname in Google Cloud. Keep the client secret in authentik's source configuration, not this repository or chat.

The upstream authentik Docker Compose installation guidance requires at least 2 CPU cores and 2 GB RAM. The test deployment pins the image version in `compose.yml`; update it deliberately, back up the database, and consult authentik's upgrade instructions before upgrading.
