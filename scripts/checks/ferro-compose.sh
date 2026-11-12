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
# repository ships neither file. The check leaves that file out, and stands
# in for the FerroEHR settings it must hold (a subject index, authentication)
# with example values, so a refusal names a key from the Compose file.
#
# The HL7 v2 face of FerroBRIDGE 0.0.24 serves MLLP over TLS only (#211,
# FerroBRIDGE book, "The HL7 v2 face"). Two checks hold that:
#   * no Compose file turns the face on (FERROBRIDGE__HL7V2__ENABLED) without
#     the three [hl7v2.tls] files beside it;
#   * the pinned image refuses the face without [hl7v2.tls] and with a sender
#     that names no certificate_subject, and accepts it with both, using
#     throwaway certificates made with openssl.
#
#   bash scripts/checks/ferro-compose.sh              # the checks
#   bash scripts/checks/ferro-compose.sh --self-test  # the [hl7v2.tls] rule alone, needs jq only
#
# Needs `docker compose` or `podman compose`, jq, openssl, and the two images
# (pulled on first use). Reads no .env file.
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v jq >/dev/null 2>&1 || {
  echo "ferro-compose: jq is not installed" >&2
  exit 2
}

# The [hl7v2.tls] keys as FerroBRIDGE reads them from the environment.
HL7V2_TLS_KEYS=(
  FERROBRIDGE__HL7V2__TLS__CERTIFICATE_FILE
  FERROBRIDGE__HL7V2__TLS__KEY_FILE
  FERROBRIDGE__HL7V2__TLS__CLIENT_CA_FILE
)

# hl7v2_tls_gaps <environment JSON>: prints each [hl7v2.tls] key that an
# environment turning the HL7 v2 face on leaves unset or empty, one per line.
# Prints nothing when the face is off.
hl7v2_tls_gaps() {
  jq -r --args '
    (.FERROBRIDGE__HL7V2__ENABLED // false | tostring | ascii_downcase) as $on
    | select($on == "true")
    | . as $env
    | $ARGS.positional[]
    | select(($env[.] // "" | tostring) == "")' "${HL7V2_TLS_KEYS[@]}" <<<"$1"
}

self_test() {
  local gaps
  gaps=$(hl7v2_tls_gaps '{}')
  [[ -z $gaps ]] || { echo "self-test: an environment without the face was refused" >&2; return 1; }
  gaps=$(hl7v2_tls_gaps '{"FERROBRIDGE__HL7V2__ENABLED":"false"}')
  [[ -z $gaps ]] || { echo "self-test: a face turned off was refused" >&2; return 1; }
  gaps=$(hl7v2_tls_gaps '{"FERROBRIDGE__HL7V2__ENABLED":"true"}')
  [[ $(wc -l <<<"$gaps") -eq 3 ]] || { echo "self-test: a face without [hl7v2.tls] was not refused" >&2; return 1; }
  gaps=$(hl7v2_tls_gaps '{"FERROBRIDGE__HL7V2__ENABLED":"TRUE",
    "FERROBRIDGE__HL7V2__TLS__CERTIFICATE_FILE":"/etc/ferrobridge/chain.pem",
    "FERROBRIDGE__HL7V2__TLS__KEY_FILE":"/etc/ferrobridge/key.pem",
    "FERROBRIDGE__HL7V2__TLS__CLIENT_CA_FILE":""}')
  [[ $gaps == FERROBRIDGE__HL7V2__TLS__CLIENT_CA_FILE ]] || {
    echo "self-test: a face with an empty client_ca_file was not refused" >&2
    return 1
  }
  gaps=$(hl7v2_tls_gaps '{"FERROBRIDGE__HL7V2__ENABLED":true,
    "FERROBRIDGE__HL7V2__TLS__CERTIFICATE_FILE":"/etc/ferrobridge/chain.pem",
    "FERROBRIDGE__HL7V2__TLS__KEY_FILE":"/etc/ferrobridge/key.pem",
    "FERROBRIDGE__HL7V2__TLS__CLIENT_CA_FILE":"/etc/ferrobridge/clients.pem"}')
  [[ -z $gaps ]] || { echo "self-test: a face with its three [hl7v2.tls] files was refused" >&2; return 1; }
  echo "ferro-compose: self-test ok"
}

case "${1:-}" in
  --self-test)
    self_test
    exit
    ;;
  "") ;;
  *)
    echo "usage: $0 [--self-test]" >&2
    exit 2
    ;;
esac

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
command -v openssl >/dev/null 2>&1 || {
  echo "ferro-compose: openssl is not installed" >&2
  exit 2
}

# The example values; none is a real secret or host. A FERRO or COMPOSE_ value
# from the caller's shell would change what the checks see.
while IFS= read -r name; do unset "$name"; done < <(compgen -e | grep -E '^(FERRO|COMPOSE_)' || true)
export EDULIMS_VERSION=0.0.0 POSTGRES_PASSWORD=example EDULIMS_DB_PASSWORD=example \
  FERROEHR_DB_PASSWORD=example BETTER_AUTH_SECRET=example \
  BETTER_AUTH_URL=https://edulims.example.test EDULIMS_DATA_KEY=example \
  FERROEHR_TOKEN_URL=https://idp.example.test/token FERROEHR_CLIENT_ID=example \
  FERROEHR_CLIENT_SECRET=example FERROEHR_SCOPE=example

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

# image_check <json> <service> [runtime args…]: runs the service's image with
# the environment Compose gives it, minus the path of the operator's file,
# plus the extra runtime arguments, and its `config check`. Sets
# CHECK_OUTPUT and CHECK_STATUS; returns 1 when the service is missing.
image_check() {
  local json=$1 service=$2
  shift 2
  local image
  image=$(jq -r --arg s "$service" '.services[$s].image // empty' <<<"$json")
  [[ -n $image ]] || return 1
  local -a env_args=()
  while IFS= read -r pair; do
    env_args+=(-e "$pair")
  done < <(jq -r --arg s "$service" \
    '.services[$s].environment // {} | to_entries[]
     | select(.key | test("_CONFIG$") | not)
     | select(.value != null) | "\(.key)=\(.value)"' <<<"$json")
  CHECK_STATUS=0
  CHECK_OUTPUT=$("$RUNTIME" run --rm --network none --read-only --tmpfs /tmp \
    ${env_args[@]+"${env_args[@]}"} "$@" "$image" config check 2>&1) || CHECK_STATUS=$?
}

# show_refusal: the last lines of a refusal, without the key listing.
show_refusal() {
  grep -vE '#  *(default|environment)' <<<"$CHECK_OUTPUT" | sed 's/^/     /' | tail -5
}

# config_check <label> <json> <service> <binary> [NAME=value…]: the image
# accepts the environment of the service, plus the extra values.
config_check() {
  local label=$1 json=$2 service=$3 binary=$4
  shift 4
  local -a extra_args=()
  local extra
  for extra in "$@"; do extra_args+=(-e "$extra"); done
  if ! image_check "$json" "$service" ${extra_args[@]+"${extra_args[@]}"}; then
    fail "$label: no $service service"
    return
  fi
  if ((CHECK_STATUS == 0)); then
    pass "$label: $binary accepts the environment of $service"
  else
    fail "$label: $binary refuses the environment of $service"
    show_refusal
  fi
}

# hl7v2_tls_rule <label> <json>: the Compose file turns the face on only with
# its three [hl7v2.tls] files.
hl7v2_tls_rule() {
  local label=$1 json=$2 gaps
  gaps=$(hl7v2_tls_gaps "$(jq -c '.services.ferrobridge.environment // {}' <<<"$json")")
  if [[ -z $gaps ]]; then
    pass "$label: ferrobridge turns the HL7 v2 face on only with [hl7v2.tls]"
  else
    fail "$label: ferrobridge turns the HL7 v2 face on without $(paste -sd ' ' - <<<"$gaps")"
  fi
}

# hl7v2_probe <json>: the pinned FerroBRIDGE refuses the HL7 v2 face without
# [hl7v2.tls] and without a certificate_subject, and accepts it with both.
# The face needs the FHIR facade; [auth] is off here only so the offline
# check reaches the [hl7v2] keys, never as a setting to copy.
hl7v2_probe() {
  local json=$1 tls
  tls=$(mktemp -d)
  # shellcheck disable=SC2064 # expand now: the directory is fixed
  trap "rm -rf '$tls'" RETURN
  if ! openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 \
    -subj /CN=clients.example.test -keyout "$tls/clients.key" -out "$tls/clients.pem" \
    >/dev/null 2>&1 ||
    ! openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 \
      -subj /CN=ferrobridge.example.test -addext subjectAltName=DNS:ferrobridge.example.test \
      -keyout "$tls/key.pem" -out "$tls/chain.pem" >/dev/null 2>&1; then
    fail "hl7v2: openssl could not make the throwaway certificates"
    return
  fi
  # The image runs as uid 65532; the throwaway key must be readable to it.
  chmod 0755 "$tls"
  chmod 0644 "$tls"/*.pem
  local -a face=(
    -e FERROBRIDGE__FACADE__ENABLED=true
    -e FERROBRIDGE__FACADE__COMPOSITION_LANGUAGE=en
    -e FERROBRIDGE__FACADE__COMPOSITION_TERRITORY=NL
    -e FERROBRIDGE__AUTH__ENABLED=false
    -e FERROBRIDGE__HL7V2__ENABLED=true
  )
  local -a files=(
    -v "$tls:/run/mllp:ro"
    -e FERROBRIDGE__HL7V2__TLS__CERTIFICATE_FILE=/run/mllp/chain.pem
    -e FERROBRIDGE__HL7V2__TLS__KEY_FILE=/run/mllp/key.pem
    -e FERROBRIDGE__HL7V2__TLS__CLIENT_CA_FILE=/run/mllp/clients.pem
  )
  local sender='FERROBRIDGE__HL7V2__SENDERS=[{ namespace_id = "AFINION1", certificate_subject = "afinion-1.lab.example.test" }]'
  local nameless='FERROBRIDGE__HL7V2__SENDERS=[{ namespace_id = "AFINION1" }]'

  image_check "$json" ferrobridge "${face[@]}" -e "$sender" || {
    fail "hl7v2: no ferrobridge service"
    return
  }
  if ((CHECK_STATUS != 0)) && grep -q 'hl7v2\.tls' <<<"$CHECK_OUTPUT"; then
    pass "hl7v2: ferrobridge refuses the HL7 v2 face without [hl7v2.tls]"
  else
    fail "hl7v2: ferrobridge does not refuse the HL7 v2 face without [hl7v2.tls] (exit $CHECK_STATUS)"
    show_refusal
  fi

  image_check "$json" ferrobridge "${face[@]}" "${files[@]}" -e "$nameless"
  if ((CHECK_STATUS != 0)) && grep -q 'certificate_subject' <<<"$CHECK_OUTPUT"; then
    pass "hl7v2: ferrobridge refuses a sender that names no certificate_subject"
  else
    fail "hl7v2: ferrobridge does not refuse a sender without certificate_subject (exit $CHECK_STATUS)"
    show_refusal
  fi

  image_check "$json" ferrobridge "${face[@]}" "${files[@]}" -e "$sender"
  if ((CHECK_STATUS == 0)); then
    pass "hl7v2: ferrobridge accepts the HL7 v2 face with [hl7v2.tls] and a certificate_subject"
  else
    fail "hl7v2: ferrobridge refuses the HL7 v2 face with [hl7v2.tls] and a certificate_subject"
    show_refusal
  fi
}

if production=$(compose_json -f compose.yaml); then
  pass "compose.yaml is valid with the example values"
  config_check compose.yaml "$production" ferroehr ferroehr \
    FERROEHR__RECORD__SUBJECT_INDEX=local FERROEHR__AUTH__ENABLED=false
  config_check compose.yaml "$production" ferrobridge ferrobridge
  hl7v2_tls_rule compose.yaml "$production"
  hl7v2_probe "$production"
else
  fail "compose.yaml is not valid with the example values"
fi

if development=$(compose_json -f compose.dev.yaml --profile ferro); then
  pass "compose.dev.yaml with the ferro profile is valid"
  config_check compose.dev.yaml "$development" ferroehr ferroehr
  config_check compose.dev.yaml "$development" ferrobridge ferrobridge
  hl7v2_tls_rule compose.dev.yaml "$development"
else
  fail "compose.dev.yaml with the ferro profile is not valid"
fi

if ((failures > 0)); then
  echo "ferro-compose: $failures check(s) failed"
  exit 1
fi
echo "ferro-compose: every check passed"
