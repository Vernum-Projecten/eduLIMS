#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Checks that FerroEHR and FerroBRIDGE accept the configuration the Compose
# files give them. Both refuse an unknown key and do not start, so a renamed
# key in a new image release is a stack that never comes up. For each service
# in compose.yaml and in compose.dev.yaml, it reads the environment Compose
# resolves with example values, and runs the pinned image's own
# `config check` with that environment, offline and read-only.
#
# compose.yaml points each service at a configuration file the operator
# writes (config/ferroehr.toml, config/ferrobridge/ferrobridge.toml). For
# FerroEHR the repository ships the reference config/ferroehr.toml.example
# (#226). The check fills its <placeholders> with throwaway values, runs the
# image's `config check` on it with the environment of compose.yaml, and reads
# the effective configuration the image prints back. The image accepts
# authentication off and a missing system client, so the check refuses both
# itself: [auth] on, a `machines` issuer, the eduLIMS system client
# `edulims-ferroehr` of that issuer writing eduLIMS-lab.v1 only, the ADMIN API
# off, and no usage report. Two altered copies of the example (authentication
# off, the system client removed) must be refused. FerroBRIDGE has no
# reference file yet, so its check leaves the file out.
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
#   bash scripts/checks/ferro-compose.sh --self-test  # the [hl7v2.tls] and FerroEHR rules alone, needs jq only
#
# Needs `docker compose` or `podman compose`, jq, openssl, python3 (3.11 or
# later, for tomllib), and the two images (pulled on first use). Reads no
# .env file.
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

# The reference FerroEHR configuration and eduLIMS's system client in it.
FERROEHR_EXAMPLE=config/ferroehr.toml.example
FERROEHR_CLIENT=edulims-ferroehr
FERROEHR_TEMPLATE=eduLIMS-lab.v1
# The operator's <placeholders> in the example, each with a throwaway value.
FERROEHR_FILL=(
  '<issuer>=https://idp.example.test/realms/edulims'
  '<provider-issuer>=urn:example:provider'
  '<provider-id>=example-provider'
  '<facility-issuer>=urn:example:facility'
  '<facility-id>=example-lab'
  '<system-id>=cdr.edulims.example.test'
)

# ferroehr_posture_gaps <effective configuration JSON>: prints each rule of
# the reference configuration that a FerroEHR configuration breaks, one per
# line. Prints nothing when it holds every rule.
ferroehr_posture_gaps() {
  jq -r --arg client "$FERROEHR_CLIENT" --arg template "$FERROEHR_TEMPLATE" '
    ([.auth.issuer[]? | select(.kind == "machines") | .issuer]) as $machines
    | [.authz.system_client[]? | select(.client_id == $client)] as $clients
    | (if .auth.enabled == true then empty else "authentication is off ([auth] enabled)" end),
      (if ($machines | length) > 0 then empty else "no [[auth.issuer]] of kind machines" end),
      (if ($clients | length) > 0 then empty else "no [[authz.system_client]] for \($client)" end),
      ($clients[] | select(.issuer as $i | $machines | index($i) | not)
        | "\($client) belongs to no machines issuer"),
      ($clients[] | select(.writes != [$template])
        | "\($client) writes \(.writes | tojson), not [\"\($template)\"]"),
      (if .api.admin == false then empty else "the ADMIN API is on ([api] admin)" end),
      (if .usage_report.enabled == false then empty else "the usage report is on ([usage_report] enabled)" end)
  ' <<<"$1"
}

self_test() {
  local gaps good
  good='{"auth":{"enabled":true,"issuer":[{"issuer":"https://idp.example.test","kind":"machines"}]},
    "authz":{"system_client":[{"issuer":"https://idp.example.test","client_id":"edulims-ferroehr",
      "writes":["eduLIMS-lab.v1"]}]},"api":{"admin":false},"usage_report":{"enabled":false}}'
  gaps=$(ferroehr_posture_gaps "$good")
  [[ -z $gaps ]] || { echo "self-test: the reference posture was refused: $gaps" >&2; return 1; }
  gaps=$(ferroehr_posture_gaps "$(jq '.auth.enabled = false' <<<"$good")")
  [[ $gaps == *"authentication is off"* ]] || { echo "self-test: authentication off was not refused" >&2; return 1; }
  gaps=$(ferroehr_posture_gaps "$(jq 'del(.authz.system_client)' <<<"$good")")
  [[ $gaps == *"no [[authz.system_client]] for edulims-ferroehr"* ]] || {
    echo "self-test: a configuration without the eduLIMS system client was not refused" >&2
    return 1
  }
  gaps=$(ferroehr_posture_gaps "$(jq '.auth.issuer[0].kind = "persons"' <<<"$good")")
  [[ $gaps == *"belongs to no machines issuer"* ]] || {
    echo "self-test: a system client of a persons issuer was not refused" >&2
    return 1
  }
  gaps=$(ferroehr_posture_gaps "$(jq '.authz.system_client[0].writes += ["other.v1"]' <<<"$good")")
  [[ $gaps == *"writes"* ]] || { echo "self-test: a system client writing another template was not refused" >&2; return 1; }
  gaps=$(ferroehr_posture_gaps "$(jq '.api.admin = true | .usage_report.enabled = true' <<<"$good")")
  [[ $(wc -l <<<"$gaps") -eq 2 ]] || { echo "self-test: the ADMIN API or the usage report on was not refused" >&2; return 1; }

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
python3 -I -c 'import tomllib' >/dev/null 2>&1 || {
  echo "ferro-compose: python3 with tomllib (3.11 or later) is not installed" >&2
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

# ferroehr_effective_json: the effective configuration `config check` printed
# into CHECK_OUTPUT, as JSON. Each `key = value  # source` line is TOML; the
# lines around them are not.
ferroehr_effective_json() {
  grep -E '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)* = ' <<<"$CHECK_OUTPUT" |
    python3 -I -c 'import json, sys, tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))'
}

# ferroehr_reference_run <json> <file>: runs the pinned FerroEHR's
# `config check` on <file> as compose.yaml mounts config/ferroehr.toml, with
# the environment of the ferroehr service. Sets CHECK_OUTPUT, CHECK_STATUS
# and GAPS (the posture rules the effective configuration breaks).
ferroehr_reference_run() {
  local json=$1 file=$2
  GAPS=""
  image_check "$json" ferroehr -v "$file:/etc/ferroehr/ferroehr.toml:ro" \
    -e FERROEHR_CONFIG=/etc/ferroehr/ferroehr.toml || return 1
  if ((CHECK_STATUS == 0)); then
    local effective
    effective=$(ferroehr_effective_json) || {
      GAPS="the effective configuration does not parse"
      return 0
    }
    GAPS=$(ferroehr_posture_gaps "$effective")
  fi
}

# ferroehr_reference <json>: the filled reference configuration passes the
# image and every posture rule, and two altered copies are refused.
ferroehr_reference() {
  local json=$1 dir pair
  dir=$(mktemp -d)
  # shellcheck disable=SC2064 # expand now: the directory is fixed
  trap "rm -rf '$dir'" RETURN
  cp "$FERROEHR_EXAMPLE" "$dir/filled.toml"
  for pair in "${FERROEHR_FILL[@]}"; do
    local placeholder=${pair%%=*} value=${pair#*=}
    sed -i.bak "s|$placeholder|$value|g" "$dir/filled.toml"
  done
  rm -f "$dir"/*.bak
  # A placeholder this script does not fill would reach the operator unnoticed.
  if grep -vE '^[[:space:]]*#' "$dir/filled.toml" | grep -qE '<[a-z-]+>'; then
    fail "$FERROEHR_EXAMPLE: a placeholder has no throwaway value: $(grep -vE '^[[:space:]]*#' "$dir/filled.toml" | grep -oE '<[a-z-]+>' | sort -u | paste -sd ' ' -)"
    return
  fi
  # The copies: [auth] enabled turned off, and the system client table removed.
  awk '/^\[/ { section = $0 } section == "[auth]" && /^enabled = true$/ { $0 = "enabled = false" } { print }' \
    "$dir/filled.toml" >"$dir/auth-off.toml"
  awk '/^\[\[authz\.system_client\]\]$/ { skip = 1; next } /^\[/ { skip = 0 } !skip' \
    "$dir/filled.toml" >"$dir/no-client.toml"
  # The image runs as uid 65532.
  chmod 0755 "$dir"
  chmod 0644 "$dir"/*.toml

  ferroehr_reference_run "$json" "$dir/filled.toml" || {
    fail "$FERROEHR_EXAMPLE: no ferroehr service"
    return
  }
  if ((CHECK_STATUS != 0)); then
    fail "$FERROEHR_EXAMPLE: ferroehr refuses the reference configuration (exit $CHECK_STATUS)"
    show_refusal
  elif [[ -n $GAPS ]]; then
    fail "$FERROEHR_EXAMPLE: the reference configuration breaks a rule: $(paste -sd ';' - <<<"$GAPS")"
  else
    pass "$FERROEHR_EXAMPLE: ferroehr accepts it with the environment of compose.yaml, and it holds every rule"
  fi

  local copy label
  for copy in auth-off no-client; do
    case $copy in
      auth-off) label="authentication off" ;;
      no-client) label="no $FERROEHR_CLIENT system client" ;;
    esac
    ferroehr_reference_run "$json" "$dir/$copy.toml"
    if ((CHECK_STATUS != 0)); then
      pass "$FERROEHR_EXAMPLE: a copy with $label is refused by ferroehr (exit $CHECK_STATUS)"
    elif [[ -n $GAPS ]]; then
      pass "$FERROEHR_EXAMPLE: a copy with $label is refused: $(paste -sd ';' - <<<"$GAPS")"
    else
      fail "$FERROEHR_EXAMPLE: a copy with $label is not refused"
    fi
  done
}

if production=$(compose_json -f compose.yaml); then
  pass "compose.yaml is valid with the example values"
  ferroehr_reference "$production"
  config_check compose.yaml "$production" ferrobridge ferrobridge
  hl7v2_tls_rule compose.yaml "$production"
  hl7v2_probe "$production"
else
  fail "compose.yaml is not valid with the example values"
fi

if development=$(compose_json -f compose.dev.yaml); then
  pass "compose.dev.yaml is valid"
  config_check compose.dev.yaml "$development" ferroehr ferroehr
  config_check compose.dev.yaml "$development" ferrobridge ferrobridge
  hl7v2_tls_rule compose.dev.yaml "$development"
else
  fail "compose.dev.yaml is not valid"
fi

if ((failures > 0)); then
  echo "ferro-compose: $failures check(s) failed"
  exit 1
fi
echo "ferro-compose: every check passed"
