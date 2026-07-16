#!/usr/bin/env bash
set -euo pipefail

ENV_PATH="${ENV_FILE:-.env}"

if [ ! -f "$ENV_PATH" ]; then
  printf '[env] ERROR: %s not found. Run `make setup` first.\n' "$ENV_PATH" >&2
  exit 1
fi

bad=0

check_value() {
  key="$1"
  bad_pattern="$2"
  hint="$3"
  value="$(grep -E "^${key}=" "$ENV_PATH" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  if printf '%s' "$value" | grep -Eq "$bad_pattern"; then
    printf '[env] ERROR: %s is "%s"; %s\n' "$key" "$value" "$hint" >&2
    bad=1
  fi
}

check_value DATABASE_URL '@localhost(:|/)|@127\.0\.0\.1(:|/)' 'for full Docker use host `postgres`, for example postgres://openminutes:<password>@postgres:5432/openminutes.'
check_value REDIS_URL '^redis://(localhost|127\.0\.0\.1)(:|/)' 'for full Docker use redis://redis:6379.'
check_value MINIO_ENDPOINT '^(localhost|127\.0\.0\.1)$' 'for full Docker use MINIO_ENDPOINT=minio.'
check_value BOT_IMAGE ':dev$' 'for production Docker use BOT_IMAGE=openminutes-bot:prod.'
check_value API_URL_FOR_BOTS 'host\.docker\.internal|localhost|127\.0\.0\.1' 'for production Docker use API_URL_FOR_BOTS=http://api:3000.'
check_value MINIO_ENDPOINT_FOR_BOTS 'host\.docker\.internal|localhost|127\.0\.0\.1' 'for production Docker use MINIO_ENDPOINT_FOR_BOTS=minio.'

if [ "$bad" -ne 0 ]; then
  printf '\n[env] This looks like a development .env. Back it up, then run `make setup`, or update it using .env.production.example.\n' >&2
  exit 1
fi
