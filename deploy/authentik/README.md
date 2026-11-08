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

A version-controlled Authentik blueprint at `blueprints/portal-access-groups.yaml` seeds three non-superuser groups: `Portal - Public`, `Portal - Family`, and `Portal - Owner`. Compose mounts it read-only into the worker. The groups do not contain users.

Compose also runs a dummy HTTP page in a non-root, read-only container with no host-published port. It is reachable only from the Docker network. If `PORTAL_TEST_EXTERNAL_HOST` is empty, Authentik creates the groups only and skips the test application/provider. To enable the test app, set that variable in the ignored `deploy/authentik/.env` to a client-reachable HTTPS URL, for example `https://<your-tailnet-hostname>:8443`, and configure Tailscale Serve to proxy that HTTPS port to `http://127.0.0.1:9000`. The blueprint creates a proxy provider and application bound to `Portal - Owner`, then assigns the provider to Authentik's embedded proxy outpost. This Compose project is intended as an isolated Authentik test instance: that assignment sets the embedded outpost's provider list to the demo provider. Do not apply this blueprint to an Authentik instance hosting other applications unless you preserve and include its existing provider assignments.

For the tailnet test route, first inspect existing Serve configuration and confirm the chosen port is unused. A typical command is:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:9000
tailscale serve status
```

Then recreate the worker so it receives the updated `.env` value and reapplies the blueprint:

```sh
docker compose up -d --force-recreate worker
docker compose logs --tail=100 worker
```

Check **Directory → Groups** and **Applications** in Authentik. Create a separate non-admin test user and deliberately add it to the intended group before testing access; superusers are not a valid test of group authorization. The test application and empty groups do not protect any real household service. Review blueprint changes before applying them; they can update the corresponding Authentik objects.

## Not configured yet

- Google OAuth source/client credentials and sign-in flow
- Invitation/approval enrollment and owner notifications
- User membership or grants for real household services
- Reverse-proxy protection of existing services and direct-port bypass closure

When exposing through Tailscale Serve, inspect the tailnet access policy and Serve status first; keep the service tailnet-only. Google redirect URI will be `https://<chosen-authentik-hostname>/source/oauth/callback/google/` when the authentik source slug is `google`; register the exact final hostname in Google Cloud. Keep the client secret in authentik's source configuration, not this repository or chat.

The upstream authentik Docker Compose installation guidance requires at least 2 CPU cores and 2 GB RAM. The test deployment pins the image version in `compose.yml`; update it deliberately, back up the database, and consult authentik's upgrade instructions before upgrading.
