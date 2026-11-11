#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Checks that FerroEHR and FerroBRIDGE accept the configuration the Compose
# files give them. Both refuse an unknown key and do not start, so a renamed
# key in a new image release is a stack that never comes up. For each service
# in compose.yaml and in compose.dev.yaml (profile `ferro`), it reads the
# environment Compose resolves with example values, and runs the pinned
# image's own `config check` with that environment, offline and read-only.
#
# compose.yaml points each service at a configuration file the operator
# writes (config/ferroehr.toml, config/ferrobridge/ferrobridge.toml). The
# check leaves that file out, and stands in for the FerroEHR settings it must
# hold (a subject index, authentication) with example values, so a refusal
# names a key from the Compose file.
#
#   bash scripts/checks/ferro-compose.sh
#
# Needs `docker compose` or `podman compose`, jq, and the two images (pulled
# on first use). Reads no .env file.
set -euo pipefail
cd "$(dirname "$0")/../.."

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
  RUNTIME=docker
elif podman compose version >/dev/null 2>&1; then
  COMPOSE=(podman compose)
  RUNTIME=podman
else
  echo "ferro-compose: neither docker compose nor podman compose is available" >&2
  exit 2
fi
command -v jq >/dev/null 2>&1 || {
  echo "ferro-compose: jq is not installed" >&2
  exit 2
}

# The example values; none is a real secret or host. A FERRO or COMPOSE_ value
# from the caller's shell would change what the checks see.
while IFS= read -r name; do unset "$name"; done < <(compgen -e | grep -E '^(FERRO|COMPOSE_)' || true)
export EDULIMS_VERSION=0.0.0 POSTGRES_PASSWORD=example EDULIMS_DB_PASSWORD=example \
  FERROEHR_DB_PASSWORD=example BETTER_AUTH_SECRET=example \
  BETTER_AUTH_URL=https://edulims.example.test EDULIMS_DATA_KEY=example

# compose_json <compose args>: the resolved file as JSON; --env-file /dev/null
# never reads the operator's or developer's .env.
compose_json() {
  "${COMPOSE[@]}" --env-file /dev/null "$@" config --format json 2>/dev/null
}

failures=0
fail() {
  echo "FAIL $*"
  failures=$((failures + 1))
}
pass() { echo "ok   $*"; }

# config_check <label> <json> <service> <binary> [NAME=value…]: runs the
# service's image with the environment Compose gives it, minus the path of the
# operator's file, plus the extra values, and its `<binary> config check`.
config_check() {
  local label=$1 json=$2 service=$3 binary=$4
  shift 4
  local image
  image=$(jq -r --arg s "$service" '.services[$s].image // empty' <<<"$json")
  if [[ -z $image ]]; then
    fail "$label: no $service service"
    return
  fi
  local -a env_args=()
  while IFS= read -r pair; do
    env_args+=(-e "$pair")
  done < <(jq -r --arg s "$service" \
    '.services[$s].environment // {} | to_entries[]
     | select(.key | test("_CONFIG$") | not)
     | select(.value != null) | "\(.key)=\(.value)"' <<<"$json")
  local extra
  for extra in "$@"; do env_args+=(-e "$extra"); done
  local output
  if output=$("$RUNTIME" run --rm --network none --read-only --tmpfs /tmp \
    ${env_args[@]+"${env_args[@]}"} "$image" config check 2>&1); then
    pass "$label: $binary accepts the environment of $service"
  else
    fail "$label: $binary refuses the environment of $service"
    grep -vE '#  *(default|environment)' <<<"$output" | sed 's/^/     /' | tail -5
  fi
}

if production=$(compose_json -f compose.yaml); then
  pass "compose.yaml is valid with the example values"
  config_check compose.yaml "$production" ferroehr ferroehr \
    FERROEHR__RECORD__SUBJECT_INDEX=local FERROEHR__AUTH__ENABLED=false
  config_check compose.yaml "$production" ferrobridge ferrobridge
else
  fail "compose.yaml is not valid with the example values"
fi

if development=$(compose_json -f compose.dev.yaml --profile ferro); then
  pass "compose.dev.yaml with the ferro profile is valid"
  config_check compose.dev.yaml "$development" ferroehr ferroehr
  config_check compose.dev.yaml "$development" ferrobridge ferrobridge
else
  fail "compose.dev.yaml with the ferro profile is not valid"
fi

if ((failures > 0)); then
  echo "ferro-compose: $failures check(s) failed"
  exit 1
fi
echo "ferro-compose: every check passed"
