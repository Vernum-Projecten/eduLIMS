#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Checks the optional log shipping override (compose.logship.yaml, ASVS 5.0
# V16.4.3) with the example values an operator puts in .env:
#   * compose.yaml alone has no forwarder and no fluentd driver;
#   * compose.yaml plus the override is a valid Compose file, sends eduLIMS's
#     stdout to the forwarder, and hardens the forwarder like the other
#     services (digest pin, read-only, no capabilities, no new privileges,
#     non-root, loopback-only port, no Docker socket);
#   * the override refuses to start without LOGSHIP_HOST;
#   * each LOGSHIP_OUTPUT has its Fluent Bit configuration, and with
#     --with-image Fluent Bit itself accepts both (`--dry-run`).
#
#   bash scripts/checks/logship-compose.sh               # Compose only
#   bash scripts/checks/logship-compose.sh --with-image  # also Fluent Bit --dry-run
#
# Needs `docker compose` or `podman compose`, and jq. Reads no .env file.
set -euo pipefail
cd "$(dirname "$0")/../.."

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
  RUNTIME=docker
elif podman compose version >/dev/null 2>&1; then
  COMPOSE=(podman compose)
  RUNTIME=podman
else
  echo "logship-compose: neither docker compose nor podman compose is available" >&2
  exit 2
fi

# The example values; none is a real secret or host. A LOGSHIP_ or COMPOSE_
# value from the caller's shell would change what the checks see.
while IFS= read -r name; do unset "$name"; done < <(compgen -e | grep -E '^(LOGSHIP_|COMPOSE_)' || true)
export EDULIMS_VERSION=0.0.0 POSTGRES_PASSWORD=example EDULIMS_DB_PASSWORD=example \
  FERROEHR_DB_PASSWORD=example BETTER_AUTH_SECRET=example EDULIMS_DATA_KEY=example \
  BETTER_AUTH_URL=https://edulims.example.test FERROEHR_TOKEN_URL=https://idp.example.test/token \
  FERROEHR_CLIENT_ID=example FERROEHR_CLIENT_SECRET=example FERROEHR_SCOPE=example

# compose [NAME=value…] <compose args>: Compose with those extra variables.
compose() {
  local -a vars=()
  while [[ ${1:-} == [A-Z]*=* ]]; do
    vars+=("$1")
    shift
  done
  # --env-file /dev/null: never read the operator's or developer's .env.
  env ${vars[@]+"${vars[@]}"} "${COMPOSE[@]}" --env-file /dev/null "$@" 2>/dev/null
}

failures=0
fail() {
  echo "FAIL $*"
  failures=$((failures + 1))
}
pass() { echo "ok   $*"; }

if ! base=$(compose -f compose.yaml config --format json); then
  echo "FAIL compose.yaml is not valid with the example values (a new required variable?)"
  exit 1
fi
if jq -e '.services.logship == null and .services.edulims.logging == null' <<<"$base" >/dev/null; then
  pass "compose.yaml alone runs no forwarder and keeps the default log driver"
else
  fail "compose.yaml alone has a forwarder or a log driver"
fi

if ! merged=$(compose LOGSHIP_HOST=logs.example.test LOGSHIP_PORT=6514 \
  -f compose.yaml -f compose.logship.yaml config --format json); then
  fail "compose.yaml + compose.logship.yaml is not a valid Compose file"
  echo "logship-compose: $failures check(s) failed"
  exit 1
fi
pass "compose.yaml + compose.logship.yaml is valid with the example values"

expect() {
  local label=$1 filter=$2
  if jq -e "$filter" <<<"$merged" >/dev/null; then pass "$label"; else fail "$label"; fi
}

expect "eduLIMS logs through the fluentd driver to the loopback port" \
  '.services.edulims.logging.driver == "fluentd"
   and .services.edulims.logging.options["fluentd-address"] == "tcp://127.0.0.1:24224"
   and .services.edulims.logging.options["fluentd-async"] == "true"'
expect "the forwarder image is pinned by tag and digest" \
  '.services.logship.image | test("^docker\\.io/fluent/fluent-bit:[0-9]+\\.[0-9]+\\.[0-9]+@sha256:[0-9a-f]{64}$")'
expect "the forwarder runs read-only, without capabilities or new privileges" \
  '.services.logship.read_only == true
   and .services.logship.cap_drop == ["ALL"]
   and (.services.logship.cap_add // [] | length) == 0
   and (.services.logship.security_opt | index("no-new-privileges:true")) != null'
expect "the forwarder runs as a non-root user" \
  '.services.logship.user | test("^[1-9][0-9]*:[1-9][0-9]*$")'
expect "the forwarder publishes its input on the loopback interface only" \
  '[.services.logship.ports[] | .host_ip] == ["127.0.0.1"]'
expect "the forwarder mounts no Docker or Podman socket and nothing writable" \
  '[.services.logship.volumes[] | select((.source | test("sock")) or (.read_only != true))] | length == 0'
expect "the forwarder sits on its own network only" \
  '(.services.logship.networks | keys) == ["logship"]'
expect "the forwarder defaults to syslog with TLS verification" \
  '(.services.logship.command | index("--config=/etc/logship/conf/fluent-bit-syslog.yaml")) != null
   and .services.logship.environment.LOGSHIP_TLS_VERIFY == "on"'

if compose LOGSHIP_PORT=6514 -f compose.yaml -f compose.logship.yaml config -q; then
  fail "the override accepts a missing LOGSHIP_HOST"
else
  pass "the override refuses a missing LOGSHIP_HOST"
fi

for output in syslog http; do
  file="docker/logship/fluent-bit-${output}.yaml"
  if [[ -f $file ]] && grep -q '"log":"security"' "$file" && grep -q 'tls: on' "$file"; then
    pass "LOGSHIP_OUTPUT=$output has $file, filtering security events, with TLS"
  else
    fail "LOGSHIP_OUTPUT=$output: $file is missing, does not filter, or has no TLS"
  fi
done

if [[ ${1:-} == --with-image ]]; then
  image=$(jq -r '.services.logship.image' <<<"$merged")
  for output in syslog http; do
    if "$RUNTIME" run --rm --network none --read-only --user 65534:65534 \
      -e LOGSHIP_HOST=logs.example.test -e LOGSHIP_PORT=6514 -e LOGSHIP_TLS_VERIFY=on \
      -e LOGSHIP_TLS_CA_FILE=/etc/ssl/certs/ca-certificates.crt -e LOGSHIP_SYSLOG_HOSTNAME=edulims \
      -e LOGSHIP_HTTP_URI=/ -e "LOGSHIP_HTTP_HEADER=X-Log-Source edulims" \
      -v "$PWD/docker/logship:/etc/logship/conf:ro" "$image" \
      /fluent-bit/bin/fluent-bit --dry-run "--config=/etc/logship/conf/fluent-bit-${output}.yaml" \
      >/dev/null 2>&1; then
      pass "Fluent Bit accepts fluent-bit-${output}.yaml"
    else
      fail "Fluent Bit refuses fluent-bit-${output}.yaml"
    fi
  done
fi

if ((failures > 0)); then
  echo "logship-compose: $failures check(s) failed"
  exit 1
fi
echo "logship-compose: every check passed"
