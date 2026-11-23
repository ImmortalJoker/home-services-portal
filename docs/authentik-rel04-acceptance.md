# Disposable Authentik runtime acceptance

The normal verifier suites do not start containers:

```sh
npm run test:authentik-verifier
```

They exercise synthetic ORM cases, the acceptance harness's transport and isolation guards, and generated Python syntax. CI runs these tests. They are **not** a real Authentik or HTTP proxy test.

## Explicit operator-only ORM rehearsal

Use the repository's supported Node.js version, Docker Compose v2 or later and an explicitly approved Docker engine. Starting this rehearsal on a shared engine needs owner approval even though its resources are isolated.

Pre-stage the repository-pinned `ghcr.io/goauthentik/server:2026.8.5` and `docker.io/library/postgres:16-alpine` images in that engine. The harness verifies the selected daemon ID, records the cached image IDs, and starts each service by its verified image ID with pulls disabled.

Choose a private, non-synced temporary directory outside every checkout, set `TMPDIR` to it, and independently obtain the approved daemon ID on the intended host. Do not derive approval merely by copying whichever engine the harness happens to select. The harness deliberately ignores inherited Docker host/context/credential settings and uses the default local socket with an empty client config.

```sh
export TMPDIR='/absolute/private/non-repository/temp-directory'
export REL04_EXPECTED_DAEMON_ID='approved-engine-id'
node scripts/authentik-rel04-acceptance.mjs --confirm-disposable-rel04
```

If Compose is not discoverable with an empty Docker client configuration, optionally set `REL04_COMPOSE_PLUGIN_DIR` to the absolute directory containing the intended executable `docker-compose`. Only that directory hint is written to the private temporary client config; no credential configuration is copied.

Each run creates a unique Compose project, a fresh database volume and an internal network. There are no published ports, host bind mounts, Docker socket, household networks, real credentials or production-data imports. Fixture upstreams are inert internal/test hostnames. Secret-bearing generated files are mode 0600 inside a mode-0700 recovery directory. Do not copy their contents into issues, commits or logs.

The harness waits for required system blueprints, applies the unwatched fixture through the pinned version's importer, checks optional providers disabled/create/reapply and embedded-outpost membership, then removes/restores only the dummy Basic-Auth provider's required managed mapping. It requires the expected verifier rejection and subsequent pass. Startup and blueprint imports have bounded 180-second command deadlines; read-only commands keep a 60-second default.

## Evidence limits

An ORM-only pass establishes model acceptance for these fixtures at the recorded code and image identities. An HTTP pass adds evidence for the dummy Owner and anonymous requests described below. Parent review and a separately inspected run against the approved engine are required to close the HTTP gate. Record actual runtime results, code and image identities, commands and exit statuses privately. Production permissions, logout and revocation, mobile clients and the cause of asynchronous mapping attachment are outside the rehearsal.

## Explicit operator-only HTTP rehearsal

Use the same engine approval, cached images and private environment setup as the ORM rehearsal.

```sh
node scripts/authentik-rel04-acceptance.mjs --confirm-disposable-rel04 --http
```

After ORM restoration, the existing Authentik worker opens fixture listeners on its internal Compose network. Network aliases route the fixture auth and proxy URLs to the embedded outpost and the fixture upstream URLs to the worker. These URLs use plain HTTP on that network only. The client disables environment proxies and limits each redirect to the fixture auth origin and the provider being tested. The harness creates a fresh dummy Owner and follows the pinned Authentik password flow and outpost callback using separate in-memory cookie jars for each provider and anonymous check. [Flow executor](https://raw.githubusercontent.com/goauthentik/authentik/version/2026.8.5/authentik/flows/views/executor.py) · [Embedded outpost endpoint selection](https://raw.githubusercontent.com/goauthentik/authentik/version/2026.8.5/internal/outpost/proxyv2/application/endpoint.go) · [Outpost callback](https://raw.githubusercontent.com/goauthentik/authentik/version/2026.8.5/internal/outpost/proxyv2/application/oauth_callback.go)

For each provider, the probe checks that an anonymous request to the protected path produces zero additional upstream arrivals, then requires exactly one authenticated arrival on that path. Transmission must receive the generated Basic Authorization and `Host: 127.0.0.1:9091`. Metrics must receive `Host: metrics.rel04.test:9000` with no Authorization header. The Metrics request already uses that authority, so this checks the delivered Host value and leaves mapping causality untested. `REL04_HTTP_PASSED` requires both listeners' assertions. Failures report fixed labels such as `REL04_HTTP_ANONYMOUS`, `REL04_HTTP_HOST` or `REL04_HTTP_AUTHORIZATION`. A readiness or provider phase failure leaves the HTTP gate open. Check the command exit and positively verified cleanup before recording a pass.

## Cleanup and failure recovery

The harness checks the approved daemon ID immediately before and after each Compose `up`, `exec` and `down` with the same sanitized Docker client configuration. A failed check stops any pending Compose command. If startup was attempted, a failed daemon check stops automated teardown and leaves cleanup unverified. These checks detect ordinary endpoint changes that persist until a check. They trust the local Docker client, socket and daemon, and a privileged socket swap between checks can evade detection.

After any startup attempt, cleanup targets only the generated project and its volumes and networks, including after a command failure or handled interruption. The harness reports successful cleanup and removes recovery files only after `down` succeeds, the daemon ID still matches, the exact Compose project label returns no containers (including stopped ones), networks or volumes, and a final daemon ID check passes. Shared cached images are retained. When using an approved shared engine, independently inspect the exact project labels and compare preexisting service container IDs, start timestamps and restart counts.

If cleanup is unverified, the harness retains the private recovery directory and reports its path and project name. Inspect the generated configuration locally without printing credentials. Verify the engine ID and run only that project's teardown with the same sanitized client configuration.

```sh
project='exact-project-printed-by-the-run'
recovery='/exact/private/recovery-directory-printed-by-the-run'
expected_daemon='approved-engine-id'
actual_daemon=$(env -i PATH="$PATH" DOCKER_CONFIG="$recovery" COMPOSE_DISABLE_ENV_FILE=1 \
  docker --config "$recovery" info --format '{{.ID}}')
test "$actual_daemon" = "$expected_daemon" &&
  env -i PATH="$PATH" DOCKER_CONFIG="$recovery" COMPOSE_DISABLE_ENV_FILE=1 \
  docker --config "$recovery" compose --project-directory "$recovery" \
  --env-file "$recovery/empty.env" -f "$recovery/compose.json" -p "$project" \
  down --volumes --timeout 10
```

After teardown, recheck the daemon ID and use the same client configuration to query `docker container ls --all --quiet`, `docker network ls --quiet` and `docker volume ls --quiet`, each with `--filter "label=com.docker.compose.project=$project"`. Remove only that run's generated files and directory once all three queries succeed with empty output and a final daemon ID check matches. Never use a global Docker prune, alter household services or weaken the network policy to make acceptance pass.
