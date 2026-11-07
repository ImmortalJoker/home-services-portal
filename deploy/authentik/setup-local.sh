#!/bin/sh
set -eu

cd "$(dirname "$0")"
if [ -e .env ]; then
  printf '%s\n' 'Refusing to overwrite existing deploy/authentik/.env.' >&2
  exit 1
fi
umask 077
pg_pass=$(openssl rand -base64 36 | tr -d '\n')
secret_key=$(openssl rand -base64 60 | tr -d '\n')
printf 'PG_PASS=%s\nAUTHENTIK_SECRET_KEY=%s\n' "$pg_pass" "$secret_key" > .env
unset pg_pass secret_key
printf '%s\n' 'Created deploy/authentik/.env with random secrets (file mode 600).'
printf '%s\n' 'The file is ignored by Git. Do not share or commit it.'
