#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# The development stack of compose.dev.yaml (PostgreSQL 18 with the eduLIMS,
# test and e2e databases, and Keycloak), through `podman compose` when podman
# is on PATH and `docker compose` otherwise. Every argument goes to compose.
#
# Usage:
#   scripts/dev/compose.sh <compose arguments>
#   scripts/dev/compose.sh up -d --wait     # pnpm dev:db: start and wait until healthy
#   scripts/dev/compose.sh down             # pnpm dev:db:stop: stop, keep the data volume
#   scripts/dev/compose.sh logs -f          # pnpm dev:db:logs: follow the logs
#   scripts/dev/compose.sh --help
#
# EDULIMS_CONTAINER_ENGINE=docker (or podman) picks the engine explicitly.
set -euo pipefail

usage() {
  awk '/^# Usage:/ { on = 1 } /^set / { on = 0 } on { sub(/^# ?/, ""); print }' "$0"
}

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 2
fi
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
  usage
  exit 0
fi

engine="${EDULIMS_CONTAINER_ENGINE:-}"
if [[ -z "$engine" ]]; then
  if command -v podman >/dev/null 2>&1; then
    engine=podman
  elif command -v docker >/dev/null 2>&1; then
    engine=docker
  else
    echo "error: neither podman nor docker is on PATH; install Podman (or Docker) with Compose." >&2
    exit 1
  fi
fi
case "$engine" in
  podman | docker) ;;
  *)
    echo "error: EDULIMS_CONTAINER_ENGINE must be podman or docker, not '${engine}'." >&2
    exit 2
    ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec "$engine" compose -f "${root}/compose.dev.yaml" "$@"
