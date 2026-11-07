# Local authentik test instance

This Compose project starts an isolated authentik identity provider for development. The web port is bound to `127.0.0.1:9000` only. It is **not** published on the LAN or tailnet, and no existing service is placed behind it. This is intentional until Google OAuth and tailnet access are configured and tested.

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

## Not configured yet

- Google OAuth source/client credentials
- Public/Tailscale HTTPS URL and callback registration
- Tailscale access policy or Serve publishing
- Email/webhook notification transport
- Groups, applications, or protected service routes

Do not publish port 9000 or bind it to `0.0.0.0`. Before adding Tailscale Serve, inspect access policy and make the portal tailnet-only. Google redirect URI will be `https://<chosen-authentik-hostname>/source/oauth/callback/google/` when the authentik source slug is `google`; register the exact final hostname in Google Cloud. Keep the client secret in authentik's source configuration, not this repository or chat.

The upstream authentik Docker Compose installation guidance requires at least 2 CPU cores and 2 GB RAM. The test deployment pins the image version in `compose.yml`; update it deliberately, back up the database, and consult authentik's upgrade instructions before upgrading.
