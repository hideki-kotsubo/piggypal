#!/usr/bin/env bash
# `docker compose up -d --build` with the current commit passed into the
# api image (docs/58 D218), so /health reports exactly what's running.
# Extra arguments go straight to compose, e.g.:
#   deploy/up.sh                      # whole stack
#   deploy/up.sh api                  # just the api
#   deploy/up.sh -f docker-compose.dev.yaml --env-file .env.dev   (dev stack)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

GIT_COMMIT="$(git rev-parse --short HEAD)"
if [[ -n "$(git status --porcelain)" ]]; then
  GIT_COMMIT="${GIT_COMMIT}-dirty"
fi
export GIT_COMMIT

compose_args=()
service_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--env-file) compose_args+=("$1" "$2"); shift 2 ;;
    *) service_args+=("$1"); shift ;;
  esac
done

echo "Building with GIT_COMMIT=${GIT_COMMIT}"
docker compose "${compose_args[@]}" up -d --build "${service_args[@]}"
