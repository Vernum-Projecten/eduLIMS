#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# Proves that FerroEHR in the dev stack (compose.dev.yaml) accepts a token
# eduLIMS fetches from the host: the client credentials grant of the realm's
# client edulims-ferroehr at Keycloak on localhost, then FerroEHR's template
# list with and without it. It checks that the token's `iss` is the issuer
# FerroEHR trusts, its `aud` the audience FerroEHR expects and its `sub` the
# service account FerroEHR reads as app-only, that FerroEHR
# answers 401 without a token, 200 with it, and 403 to a token that lacks the
# template scope. It prints status codes and claim names, never a token.
#
# Usage:
#   scripts/dev/ferroehr-auth-check.sh          # against the running dev stack
#   EDULIMS_DEV_KEYCLOAK_PORT=28180 EDULIMS_DEV_FERROEHR_PORT=28080 \
#     scripts/dev/ferroehr-auth-check.sh        # against a stack on other ports
#
# Needs curl and jq. The client id, secret and scopes are the public dev values
# of docker/keycloak/edulims-realm.json.
set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "ferroehr-auth-check: jq is not installed" >&2; exit 2; }

keycloak="http://localhost:${EDULIMS_DEV_KEYCLOAK_PORT:-8180}"
issuer="${keycloak}/realms/edulims"
ferroehr="http://localhost:${EDULIMS_DEV_FERROEHR_PORT:-8080}/ferroehr/rest/openehr/v1"
client_id=edulims-ferroehr
client_secret=edulims-dev-ferroehr-secret
# The fixed id of service-account-edulims-ferroehr in the realm file, which
# compose.dev.yaml lists in FERROEHR__AUTH__ISSUER__0__APP_ONLY__0__SUBJECTS.
service_account=f1c34e57-c0f7-4482-b9b3-e3d138c8e79d
scope='system/composition-*.cr system/template-*.cr system/aql-eu.edulims::*.s'

failures=0
check() {
  if [[ "$2" == "$3" ]]; then
    echo "ok   $1"
  else
    echo "FAIL $1: expected $3, got $2"
    failures=$((failures + 1))
  fi
}

# token <scope>: an access token of the client for the scope.
token() {
  curl -sf -d grant_type=client_credentials -d "client_id=${client_id}" \
    -d "client_secret=${client_secret}" --data-urlencode "scope=$1" \
    "${issuer}/protocol/openid-connect/token" | jq -r .access_token
}

# claims <token>: the token's payload as JSON (base64url without padding).
claims() {
  local payload
  payload=$(cut -d. -f2 <<<"$1" | tr '_-' '/+')
  while ((${#payload} % 4)); do payload+="="; done
  base64 -d <<<"$payload" 2>/dev/null || base64 -D <<<"$payload"
}

# status <token or empty>: FerroEHR's status for the template list.
status() {
  local -a auth=()
  [[ -z "$1" ]] || auth=(-H "Authorization: Bearer $1")
  curl -s -o /dev/null -w '%{http_code}' ${auth[@]+"${auth[@]}"} "${ferroehr}/definition/template/adl1.4"
}

access=$(token "$scope") || { echo "FAIL no token from ${issuer}" >&2; exit 1; }
payload=$(claims "$access")
check "iss is the issuer FerroEHR trusts" "$(jq -r .iss <<<"$payload")" "$issuer"
check "aud names ferroehr" "$(jq -r '[.aud] | flatten | index("ferroehr") != null' <<<"$payload")" true
check "azp names the client" "$(jq -r .azp <<<"$payload")" "$client_id"
check "sub is the service account FerroEHR lists as app-only" "$(jq -r .sub <<<"$payload")" "$service_account"
check "scope holds the template grant" "$(jq -r '.scope | split(" ") | index("system/template-*.cr") != null' <<<"$payload")" true

check "no token: 401" "$(status "")" 401
check "the client's token: 200" "$(status "$access")" 200
check "a token without the template scope: 403" "$(status "$(token 'system/aql-eu.edulims::*.s')")" 403

if ((failures > 0)); then
  echo "ferroehr-auth-check: ${failures} check(s) failed"
  exit 1
fi
echo "ferroehr-auth-check: FerroEHR accepts the host's token"
