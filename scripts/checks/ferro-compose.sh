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
# compose.dev.yaml's FerroEHR has no file and runs with authentication on as
# in production (#225). The check reads the effective configuration the image
# prints for its environment and holds it to the same rules (#239); three
# altered copies of that environment (authentication off, the system client
# removed, the issuer of kind `persons`) must be refused.
#
# FerroEHR and `ferroehr-definitions` in compose.yaml reach PostgreSQL over
# verified TLS with the CA eduLIMS trusts (ADR 0013, #244): every database URL
# they get says `sslmode=verify-full` and names in `sslrootcert` a file
# mounted from the same source as the CA of eduLIMS's DATABASE_URL. FerroEHR
# takes the DSN as given (FerroEHR book v5.7.0, installation/config-server.md,
# [database] `url`; installation/kubernetes.md and operations.md, "TLS and
# database security", for the `sslmode=verify-full&sslrootcert=` form).
# `config check` masks the query string, so the rule reads the Compose
# environment. The development PostgreSQL runs without TLS, so the rule holds
# compose.yaml only.
#
# FerroEHR refuses to start while a template a system client writes is not
# stored (#146). In both Compose files the one-shot `ferroehr-definitions`
# must load every template in docker/ferroehr/definitions/ with the ferroehr
# image and environment before ferroehr starts. The pinned image then loads
# them with `ferroehr definitions load` on a throwaway PostgreSQL (tmpfs, an
# internal network of its own): stored on the first load, left alone on the
# second, and a changed copy under the same id refused.
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
#   bash scripts/checks/ferro-compose.sh --self-test  # the rules alone, without images; needs jq only
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
# The operational templates FerroEHR loads before it serves, in load order.
FERROEHR_DEFINITIONS=docker/ferroehr/definitions
FERROEHR_DEFINITION_FILES=("$FERROEHR_TEMPLATE.opt")
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

# ferroehr_dev_copy <copy> <compose JSON>: the Compose file with the ferroehr
# service's environment altered: `auth-off`, `no-client` (every system client
# key removed) or `persons-issuer` (every issuer of kind persons).
ferroehr_dev_copy() {
  local filter
  case $1 in
    auth-off) filter='.FERROEHR__AUTH__ENABLED = "false"' ;;
    no-client) filter='with_entries(select(.key | startswith("FERROEHR__AUTHZ__SYSTEM_CLIENT__") | not))' ;;
    persons-issuer) filter='with_entries(if .key | test("^FERROEHR__AUTH__ISSUER__[0-9]+__KIND$") then .value = "persons" else . end)' ;;
    *) return 2 ;;
  esac
  jq -c ".services.ferroehr.environment |= ($filter)" <<<"$2"
}

# database_tls_gaps <compose JSON>: prints each way the database URLs of
# ferroehr and ferroehr-definitions fall short of verified TLS with the CA of
# eduLIMS's DATABASE_URL, one per line. Prints nothing when they hold.
database_tls_gaps() {
  jq -r '
    def params: (split("?")[1] // "") | split("&") | map(select(. != "") | split("=")
      | {key: .[0], value: (.[1:] | join("="))});
    def values($k): params | map(select(.key == $k) | .value);
    def mounted($svc; $target): [$svc.volumes[]? | select(.target == $target) | .source][0];
    .services as $s
    | ($s.edulims.environment.DATABASE_URL // "" | values("sslrootcert")) as $roots
    | (if ($roots | length) == 1 then mounted($s.edulims; $roots[0]) else null end) as $ca
    | if $ca == null then "edulims: its DATABASE_URL names no mounted sslrootcert to compare with" else
        ("ferroehr", "ferroehr-definitions") as $name
        | ($s[$name] // null) as $svc
        | select($svc != null)
        | [$svc.environment // {} | to_entries[]
            | select(.key | test("^(FERROEHR__DATABASE__([A-Z0-9]+__)?(MIGRATE_)?URL(_FILE)?|DATABASE_URL)$"))] as $dsns
        | if ($dsns | length) == 0 then "\($name): no FERROEHR__DATABASE__URL" else
            $dsns[]
            | if (.key | endswith("_FILE")) then "\($name): \(.key) reads its DSN from a file this check cannot read"
              else
                .key as $key | (.value // "" | tostring) as $url
                | ($url | values("sslmode")) as $modes
                | ($url | values("sslrootcert")) as $certs
                | (if $modes == ["verify-full"] then empty
                   else "\($name): \($key) does not say sslmode=verify-full" end),
                  (if ($certs | length) != 1 then "\($name): \($key) names no sslrootcert"
                   elif mounted($svc; $certs[0]) == $ca then empty
                   else "\($name): \($key) sslrootcert \($certs[0]) is not mounted from \($ca), the CA eduLIMS trusts" end)
              end
          end
      end' <<<"$1"
}

# The names the Compose files render into the Ferro services. eduLIMS's own
# FERROEHR_ settings (FERROEHR_TOKEN_URL and the like, src/server/env.ts) are
# not among them and keep the caller's value.
FERRO_COMPOSE_NAMES=(
  FERROEHR_DB_USER FERROEHR_DB_PASSWORD FERROEHR_DB_NAME FERROEHR_LOG_FILTER
  FERROBRIDGE_LOG_FILTER FERROBRIDGE_MLLP_BIND_HOST FERROBRIDGE_MLLP_PORT
)
EDULIMS_FERRO_NAMES=(FERROEHR_TOKEN_URL FERROEHR_CLIENT_ID FERROEHR_CLIENT_SECRET FERROEHR_SCOPE)

# ferro_service_variables: reads variable names, one per line, and prints
# those that change what the Ferro services see: their own keys (FERROEHR__…,
# FERROBRIDGE__…, FERROEHR_CONFIG, FERROBRIDGE_CONFIG), the Compose names in
# FERRO_COMPOSE_NAMES, and COMPOSE_ settings.
ferro_service_variables() {
  local name known
  while IFS= read -r name; do
    if [[ $name =~ ^FERRO(EHR|BRIDGE)(__|_CONFIG$) || $name == COMPOSE_* ]]; then
      echo "$name"
      continue
    fi
    for known in "${FERRO_COMPOSE_NAMES[@]}"; do
      [[ $name == "$known" ]] && echo "$name"
    done
  done
}

# ferro_name_gaps <Compose file text>: prints each FERRO name the file
# interpolates that neither list above knows, so a new one is not missed.
ferro_name_gaps() {
  local name known found
  while IFS= read -r name; do
    found=0
    for known in "${FERRO_COMPOSE_NAMES[@]}" "${EDULIMS_FERRO_NAMES[@]}"; do
      [[ $name == "$known" ]] && found=1
    done
    ((found)) || echo "$name"
  done < <(grep -oE '\$\{FERRO[A-Z0-9_]*' <<<"$1" | cut -c3- | sort -u)
}

# reset_environment: unsets the Ferro services' variables from the caller's
# shell and exports the example values; none is a real secret or host.
reset_environment() {
  local name
  while IFS= read -r name; do unset "$name"; done < <(compgen -e | ferro_service_variables)
  export EDULIMS_VERSION=0.0.0 POSTGRES_PASSWORD=example EDULIMS_DB_PASSWORD=example \
    FERROEHR_DB_PASSWORD=example BETTER_AUTH_SECRET=example \
    BETTER_AUTH_URL=https://edulims.example.test EDULIMS_DATA_KEY=example
  : "${FERROEHR_TOKEN_URL:=https://idp.example.test/token}" "${FERROEHR_CLIENT_ID:=example}" \
    "${FERROEHR_CLIENT_SECRET:=example}" "${FERROEHR_SCOPE:=example}"
  export FERROEHR_TOKEN_URL FERROEHR_CLIENT_ID FERROEHR_CLIENT_SECRET FERROEHR_SCOPE
}

# self_test_tls: the database TLS rule on a fixture shaped as
# `compose config --format json` prints it.
self_test_tls() {
  local good gaps ca=/srv/edulims/config/postgres-tls/ca.crt
  local base='postgres://ferroehr:example@postgres:5432/ferroehr'
  good=$(jq -nc --arg ca "$ca" --arg url "$base?sslmode=verify-full&sslrootcert=/etc/ferroehr/postgres-ca.crt" '
    {services: {
      edulims: {environment: {DATABASE_URL: "postgres://edulims:example@postgres:5432/edulims?sslmode=verify-full&sslrootcert=/etc/edulims/postgres-ca.crt"},
        volumes: [{type: "bind", source: $ca, target: "/etc/edulims/postgres-ca.crt", read_only: true}]},
      ferroehr: {environment: {FERROEHR__DATABASE__URL: $url},
        volumes: [{type: "bind", source: $ca, target: "/etc/ferroehr/postgres-ca.crt", read_only: true}]},
      "ferroehr-definitions": {environment: {FERROEHR__DATABASE__URL: $url},
        volumes: [{type: "bind", source: $ca, target: "/etc/ferroehr/postgres-ca.crt", read_only: true}]}}}')
  gaps=$(database_tls_gaps "$good")
  [[ -z $gaps ]] || { echo "self-test: verified TLS with eduLIMS's CA was refused: $gaps" >&2; return 1; }
  local case_ want
  for case_ in "$base|sslmode=verify-full" \
    "$base?sslmode=require&sslrootcert=/etc/ferroehr/postgres-ca.crt|sslmode=verify-full" \
    "$base?sslmode=verify-ca&sslrootcert=/etc/ferroehr/postgres-ca.crt|sslmode=verify-full" \
    "$base?sslmode=disable&sslmode=verify-full&sslrootcert=/etc/ferroehr/postgres-ca.crt|sslmode=verify-full" \
    "$base?sslmode=verify-full|names no sslrootcert" \
    "$base?sslmode=verify-full&sslrootcert=/etc/ssl/other.crt|is not mounted from"; do
    want=${case_#*|}
    gaps=$(database_tls_gaps "$(jq -c --arg url "${case_%%|*}" \
      '.services["ferroehr-definitions"].environment.FERROEHR__DATABASE__URL = $url' <<<"$good")")
    [[ $gaps == "ferroehr-definitions: "*"$want"* ]] || {
      echo "self-test: the database URL ${case_%%|*} was not refused ($want): $gaps" >&2
      return 1
    }
  done
  gaps=$(database_tls_gaps "$(jq -c '.services.ferroehr.volumes[0].source = "/srv/other/ca.crt"' <<<"$good")")
  [[ $gaps == *"is not mounted from $ca"* ]] || { echo "self-test: a CA other than eduLIMS's was not refused" >&2; return 1; }
  gaps=$(database_tls_gaps "$(jq -c '.services.ferroehr.environment += {FERROEHR__DATABASE__MIGRATE_URL: "postgres://x@postgres/ferroehr"}' <<<"$good")")
  [[ $gaps == *"FERROEHR__DATABASE__MIGRATE_URL does not say sslmode=verify-full"* ]] || {
    echo "self-test: a plain migrate_url was not refused" >&2
    return 1
  }
  gaps=$(database_tls_gaps "$(jq -c '.services.ferroehr.environment = {FERROEHR__DATABASE__URL_FILE: "/run/dsn"}' <<<"$good")")
  [[ $gaps == *"cannot read"* ]] || { echo "self-test: a DSN from a file was not refused" >&2; return 1; }
  gaps=$(database_tls_gaps "$(jq -c '.services.ferroehr.environment = {}' <<<"$good")")
  [[ $gaps == "ferroehr: no FERROEHR__DATABASE__URL" ]] || { echo "self-test: a missing database URL was not refused" >&2; return 1; }
}

# reset_and_print: runs reset_environment and prints the variables the
# self-test asks about, `unset` for one that is gone.
reset_and_print() {
  reset_environment
  echo "$FERROEHR_TOKEN_URL $FERROEHR_CLIENT_ID $FERROEHR_CLIENT_SECRET $FERROEHR_SCOPE"
  echo "${FERROEHR__AUTH__ENABLED-unset} ${FERROBRIDGE__HL7V2__ENABLED-unset} ${FERROEHR_CONFIG-unset}"
  echo "${FERROBRIDGE_CONFIG-unset} ${FERROEHR_DB_USER-unset} $FERROEHR_DB_PASSWORD ${FERROEHR_LOG_FILTER-unset}"
  echo "${FERROBRIDGE_MLLP_PORT-unset} ${COMPOSE_FILE-unset}"
}

# self_test_environment: the reset keeps eduLIMS's FERROEHR_ settings and
# clears the Ferro services' variables; the dev copies alter what they say.
self_test_environment() {
  local out
  out=$(FERROEHR_TOKEN_URL=https://idp.own.test/token FERROEHR_CLIENT_ID=own FERROEHR_CLIENT_SECRET=own-secret \
    FERROEHR_SCOPE=own-scope FERROEHR__AUTH__ENABLED=false FERROBRIDGE__HL7V2__ENABLED=true \
    FERROEHR_CONFIG=/x FERROBRIDGE_CONFIG=/x FERROEHR_DB_USER=other FERROEHR_DB_PASSWORD=other \
    FERROEHR_LOG_FILTER=trace FERROBRIDGE_MLLP_PORT=1 COMPOSE_FILE=other.yaml reset_and_print)
  [[ $(sed -n 1p <<<"$out") == "https://idp.own.test/token own own-secret own-scope" ]] || {
    echo "self-test: eduLIMS's FERROEHR_ settings did not survive: $(sed -n 1p <<<"$out")" >&2
    return 1
  }
  [[ $(sed -n '2,4p' <<<"$out" | paste -sd ' ' -) == "unset unset unset unset unset example unset unset unset" ]] || {
    echo "self-test: a Ferro service variable survived: $(sed -n '2,4p' <<<"$out" | paste -sd ' ' -)" >&2
    return 1
  }
  # shellcheck disable=SC2016 # Compose text, not shell: nothing expands
  out=$(ferro_name_gaps 'a: ${FERROEHR_DB_USER:-ferroehr} b: ${FERROEHR_SCOPE:?} c: ${FERROEHR_NEW_THING}')
  [[ $out == FERROEHR_NEW_THING ]] || { echo "self-test: an unknown FERRO name was not reported: $out" >&2; return 1; }

  local dev
  dev='{"services":{"ferroehr":{"environment":{"FERROEHR__AUTH__ENABLED":"true",
    "FERROEHR__AUTH__ISSUER__0__KIND":"machines","FERROEHR__AUTH__ISSUER__0__ISSUER":"http://localhost:8180/realms/edulims",
    "FERROEHR__AUTHZ__SYSTEM_CLIENT__0__CLIENT_ID":"edulims-ferroehr","FERROEHR__AUTHZ__SYSTEM_CLIENT__0__WRITES":"eduLIMS-lab.v1"}}}}'
  [[ $(ferroehr_dev_copy auth-off "$dev" | jq -r '.services.ferroehr.environment.FERROEHR__AUTH__ENABLED') == false ]] || {
    echo "self-test: the dev copy with authentication off does not turn it off" >&2
    return 1
  }
  [[ $(ferroehr_dev_copy no-client "$dev" | jq -r '.services.ferroehr.environment | keys | map(select(startswith("FERROEHR__AUTHZ__"))) | length') == 0 ]] || {
    echo "self-test: the dev copy without the system client keeps a system client key" >&2
    return 1
  }
  [[ $(ferroehr_dev_copy persons-issuer "$dev" | jq -r '.services.ferroehr.environment.FERROEHR__AUTH__ISSUER__0__KIND') == persons ]] || {
    echo "self-test: the dev copy with a persons issuer keeps the machines kind" >&2
    return 1
  }
}

self_test() {
  self_test_tls
  self_test_environment
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

# A Ferro service's variable from the caller's shell would change what the
# checks see.
reset_environment

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

# definitions_rule <label> <json>: the one-shot `ferroehr-definitions` runs the
# ferroehr image with its environment, loads every template under
# FERROEHR_DEFINITIONS, and ferroehr starts only after it exits 0.
definitions_rule() {
  local label=$1 json=$2 gaps
  gaps=$(jq -r --args '
    .services as $s
    | ($s["ferroehr-definitions"] // null) as $d
    | if $d == null then "no ferroehr-definitions service" else
        (if $d.image == $s.ferroehr.image then empty else "its image is not the ferroehr image" end),
        (if $d.environment == $s.ferroehr.environment then empty else "its environment is not that of ferroehr" end),
        (if ($d.command // [])[0:2] == ["definitions", "load"] then empty else "its command is not `definitions load`" end),
        ($ARGS.positional[] | select(. as $f | ($d.command // []) | index("/etc/ferroehr/definitions/" + $f) | not)
          | "it does not load \(.)"),
        (if $s.ferroehr.depends_on["ferroehr-definitions"].condition == "service_completed_successfully" then empty
         else "ferroehr does not wait for it to exit 0" end)
      end' "${FERROEHR_DEFINITION_FILES[@]}" <<<"$json")
  if [[ -z $gaps ]]; then
    pass "$label: ferroehr-definitions loads ${FERROEHR_DEFINITION_FILES[*]} before ferroehr starts"
  else
    fail "$label: ferroehr-definitions: $(paste -sd ';' - <<<"$gaps")"
  fi
}

# indent_tail <text>: the last lines of a refusal, indented.
indent_tail() {
  local line
  tail -5 <<<"$1" | while IFS= read -r line; do echo "     $line"; done
}

# definitions_probe <json>: the pinned FerroEHR stores each template on an
# empty throwaway database, leaves it alone on a second load, and refuses a
# changed copy under the same id. PostgreSQL runs on a tmpfs and both
# containers share an internal network of their own, so nothing persists and
# nothing reaches out.
definitions_probe() {
  local json=$1 image pg_image net pg dir file
  image=$(jq -r '.services.ferroehr.image // empty' <<<"$json")
  pg_image=$(jq -r '.services.postgres.image // empty' <<<"$json")
  [[ -n $image && -n $pg_image ]] || {
    fail "definitions: no ferroehr or postgres service"
    return
  }
  net="ferro-compose-$$"
  pg="ferro-compose-pg-$$"
  dir=$(mktemp -d)
  # shellcheck disable=SC2064 # expand now: the names are fixed
  trap "$RUNTIME rm -f '$pg' >/dev/null 2>&1; $RUNTIME network rm '$net' >/dev/null 2>&1; rm -rf '$dir'" RETURN
  "$RUNTIME" network create --internal "$net" >/dev/null
  "$RUNTIME" run -d --name "$pg" --network "$net" --tmpfs /var/lib/postgresql --tmpfs /var/run/postgresql \
    -e POSTGRES_PASSWORD=example -e PG_INIT_USER=ferroehr -e PG_INIT_PASSWORD=example -e PG_INIT_DB=ferroehr \
    "$pg_image" >/dev/null
  local ready=0 _
  for _ in $(seq 1 60); do
    # The image's init scripts restart the server once; ask twice in a row.
    if "$RUNTIME" exec "$pg" pg_isready -h 127.0.0.1 -U ferroehr -d ferroehr >/dev/null 2>&1; then
      ready=$((ready + 1))
      ((ready >= 2)) && break
    else
      ready=0
    fi
    sleep 2
  done
  if ((ready < 2)); then
    fail "definitions: the throwaway PostgreSQL did not become ready"
    return
  fi
  cp "${FERROEHR_DEFINITION_FILES[@]/#/$FERROEHR_DEFINITIONS/}" "$dir/"
  file=${FERROEHR_DEFINITION_FILES[0]}
  sed 's|<concept>|<concept>changed |' "$dir/$file" >"$dir/changed-$file"
  chmod 0755 "$dir"
  chmod 0644 "$dir"/*
  local -a load=("$RUNTIME" run --rm --network "$net" --read-only --tmpfs /tmp -v "$dir:/etc/ferroehr/definitions:ro"
    -e "FERROEHR__DATABASE__URL=postgres://ferroehr:example@$pg:5432/ferroehr"
    -e FERROEHR__RECORD__SUBJECT_INDEX=local -e FERROEHR__USAGE_REPORT__ENABLED=false
    "$image" definitions load)
  local -a files=("${FERROEHR_DEFINITION_FILES[@]/#//etc/ferroehr/definitions/}")
  local output status round
  for round in first second; do
    status=0
    output=$("${load[@]}" "${files[@]}" 2>&1) || status=$?
    if ((status == 0)); then
      pass "definitions: ferroehr accepts ${FERROEHR_DEFINITION_FILES[*]} on the $round load: $(paste -sd ';' - <<<"$output")"
    else
      fail "definitions: ferroehr refuses ${FERROEHR_DEFINITION_FILES[*]} on the $round load (exit $status)"
      indent_tail "$output"
      return
    fi
  done
  status=0
  output=$("${load[@]}" "/etc/ferroehr/definitions/changed-$file" 2>&1) || status=$?
  if ((status != 0)) && grep -q 'other content' <<<"$output"; then
    pass "definitions: ferroehr refuses a changed $file under the same id"
  else
    fail "definitions: ferroehr does not refuse a changed $file under the same id (exit $status)"
    indent_tail "$output"
  fi
}

# database_tls_rule <label> <json>: FerroEHR's database URLs ask for
# verified TLS with eduLIMS's CA.
database_tls_rule() {
  local label=$1 json=$2 gaps
  gaps=$(database_tls_gaps "$json")
  if [[ -z $gaps ]]; then
    pass "$label: ferroehr and ferroehr-definitions reach PostgreSQL over verified TLS with eduLIMS's CA"
  else
    fail "$label: $(paste -sd ';' - <<<"$gaps")"
  fi
}

# ferro_names_rule <file>…: every FERRO name the Compose files interpolate is
# a Ferro service's or one of eduLIMS's own settings.
ferro_names_rule() {
  local gaps
  gaps=$(ferro_name_gaps "$(cat "$@")")
  if [[ -z $gaps ]]; then
    pass "$*: every interpolated FERRO name is known to the environment reset"
  else
    fail "$*: unknown FERRO names, add each to FERRO_COMPOSE_NAMES or EDULIMS_FERRO_NAMES: $(paste -sd ' ' - <<<"$gaps")"
  fi
}

# ferroehr_dev_run <json>: runs the pinned FerroEHR's `config check` with the
# environment of the ferroehr service in <json>. Sets CHECK_OUTPUT,
# CHECK_STATUS and GAPS (the posture rules the effective configuration breaks).
ferroehr_dev_run() {
  GAPS=""
  image_check "$1" ferroehr || return 1
  if ((CHECK_STATUS == 0)); then
    local effective
    effective=$(ferroehr_effective_json) || {
      GAPS="the effective configuration does not parse"
      return 0
    }
    GAPS=$(ferroehr_posture_gaps "$effective")
  fi
}

# ferroehr_dev <json>: the dev FerroEHR passes the image and every posture
# rule, and three altered copies of its environment are refused.
ferroehr_dev() {
  local json=$1 copy
  ferroehr_dev_run "$json" || {
    fail "compose.dev.yaml: no ferroehr service"
    return
  }
  if ((CHECK_STATUS != 0)); then
    fail "compose.dev.yaml: ferroehr refuses the environment of ferroehr (exit $CHECK_STATUS)"
    show_refusal
  elif [[ -n $GAPS ]]; then
    fail "compose.dev.yaml: ferroehr breaks a rule: $(paste -sd ';' - <<<"$GAPS")"
  else
    pass "compose.dev.yaml: ferroehr accepts the environment of ferroehr, and it holds every rule"
  fi
  for copy in auth-off no-client persons-issuer; do
    ferroehr_dev_run "$(ferroehr_dev_copy "$copy" "$json")"
    if ((CHECK_STATUS != 0)); then
      pass "compose.dev.yaml: a copy with $copy is refused by ferroehr (exit $CHECK_STATUS)"
    elif [[ -n $GAPS ]]; then
      pass "compose.dev.yaml: a copy with $copy is refused: $(paste -sd ';' - <<<"$GAPS")"
    else
      fail "compose.dev.yaml: a copy with $copy is not refused"
    fi
  done
}

ferro_names_rule compose.yaml compose.dev.yaml

if production=$(compose_json -f compose.yaml); then
  pass "compose.yaml is valid with the example values"
  definitions_rule compose.yaml "$production"
  database_tls_rule compose.yaml "$production"
  definitions_probe "$production"
  ferroehr_reference "$production"
  config_check compose.yaml "$production" ferrobridge ferrobridge
  hl7v2_tls_rule compose.yaml "$production"
  hl7v2_probe "$production"
else
  fail "compose.yaml is not valid with the example values"
fi

if development=$(compose_json -f compose.dev.yaml); then
  pass "compose.dev.yaml is valid"
  definitions_rule compose.dev.yaml "$development"
  ferroehr_dev "$development"
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
