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

A pass establishes real model/ORM acceptance for these fixtures at the recorded code/image identities. It does **not** establish upstream Authorization/Host headers, live outpost HTTP handling, real-user permission checks, logout/revocation, mobile compatibility, or causality of asynchronous default-mapping attachment. No deployment or merge is performed. Keep actual runtime results separate from the synthetic suites and record exact commands, image identities and exits privately.

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
