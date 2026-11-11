#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# Brings a local env file up to date with the example env file, without ever
# printing a value, so a developer's own settings and secrets stay theirs:
#   * a variable the example sets and the env file lacks is appended with the
#     example's value;
#   * a value already in the env file is never changed;
#   * a variable the project no longer reads (OBSOLETE below) is commented out
#     with a note, never deleted;
#   * an empty BETTER_AUTH_SECRET gets a fresh random one (openssl rand -hex 32),
#     and an empty EDULIMS_DATA_KEY one too (openssl rand -base64 32);
#   * a missing env file is created from the example first.
# It prints variable names only.
#
# Usage:
#   scripts/dev/env-sync.sh                     # pnpm env:sync
#   scripts/dev/env-sync.sh --env <file> --example <file>
#   scripts/dev/env-sync.sh --self-test
#   scripts/dev/env-sync.sh --help
set -euo pipefail

# Variables the project no longer reads from the env file, with the reason.
OBSOLETE=(
  "NODE_ENV|pnpm dev and pnpm build set it; in this file it breaks pnpm build (#19)"
  "MICROSOFT_CLIENT_ID|identity providers live in the database now: Admin > System > Identity providers (#46)"
  "MICROSOFT_CLIENT_SECRET|identity providers live in the database now; the secret is sealed there (#46)"
  "MICROSOFT_TENANT_ID|identity providers live in the database now: Entra ID is an OIDC provider (#46)"
  "KEYCLOAK_ISSUER|identity providers live in the database now; pnpm db:seed registers the dev Keycloak (#46)"
  "KEYCLOAK_CLIENT_ID|identity providers live in the database now; pnpm db:seed registers the dev Keycloak (#46)"
  "KEYCLOAK_CLIENT_SECRET|identity providers live in the database now; the secret is sealed there (#46)"
  "KEYCLOAK_LABEL|the button label is set per provider in Admin > System > Identity providers (#46)"
  "OIDC_ROLE_CLAIM|the role claim is set per provider in Admin > System > Identity providers (#46)"
  "OIDC_ROLE_MAP|the role map is set per provider in Admin > System > Identity providers (#46)"
  "OIDC_DEFAULT_ROLE|the default role is set per provider in Admin > System > Identity providers (#46)"
)

usage() {
  awk '/^# Usage:/ { on = 1 } /^set / { on = 0 } on { sub(/^# ?/, ""); print }' "$0"
}

# Prints the variable names a file assigns on uncommented lines.
assigned() {
  sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' "$1"
}

# Sets an empty NAME= line of FILE to VALUE, without printing the value.
fill() {
  local file=$1 name=$2 value=$3 tmp
  tmp=$(mktemp)
  awk -v n="$name" -v v="$value" '$0 ~ "^[[:space:]]*" n "=[[:space:]]*$" { print n "=" v; next } { print }' "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

sync() {
  local target=$1 example=$2 today added=() obsolete=()
  [[ -f "$example" ]] || { echo "env-sync: no example file at $example" >&2; exit 1; }
  if [[ ! -f "$target" ]]; then
    cp "$example" "$target"
    chmod 600 "$target"
    echo "env-sync: created $(basename "$target") from $(basename "$example")"
  fi
  today=$(date +%Y-%m-%d)

  local name line obsolete_names
  obsolete_names=$(printf '%s\n' "${OBSOLETE[@]}" | cut -d'|' -f1)
  while IFS= read -r name; do
    if grep -qx "$name" <<<"$obsolete_names"; then
      continue
    fi
    if ! assigned "$target" | grep -qx "$name"; then
      line=$(grep -m1 -E "^[[:space:]]*(export[[:space:]]+)?${name}=" "$example")
      added+=("$name")
      if [[ ${#added[@]} -eq 1 ]]; then
        printf '\n# Added by pnpm env:sync on %s from the example file.\n' "$today" >> "$target"
      fi
      printf '%s\n' "$line" >> "$target"
    fi
  done < <(assigned "$example" | awk '!seen[$0]++')

  local entry reason tmp
  for entry in "${OBSOLETE[@]}"; do
    name=${entry%%|*}
    reason=${entry#*|}
    if assigned "$target" | grep -qx "$name"; then
      tmp=$(mktemp)
      awk -v n="$name" -v r="$reason" '
        $0 ~ "^[[:space:]]*(export[[:space:]]+)?" n "=" { print "# Obsolete (" r "):"; print "# " $0; next }
        { print }' "$target" > "$tmp"
      cat "$tmp" > "$target"
      rm -f "$tmp"
      obsolete+=("$name")
    fi
  done

  local secret_set=0 key_set=0
  if grep -qE '^[[:space:]]*BETTER_AUTH_SECRET=[[:space:]]*$' "$target"; then
    fill "$target" BETTER_AUTH_SECRET "$(openssl rand -hex 32)"
    secret_set=1
  fi
  if grep -qE '^[[:space:]]*EDULIMS_DATA_KEY=[[:space:]]*$' "$target"; then
    fill "$target" EDULIMS_DATA_KEY "$(openssl rand -base64 32)"
    key_set=1
  fi

  if [[ ${#added[@]} -gt 0 ]]; then echo "env-sync: added ${added[*]}"; fi
  if [[ ${#obsolete[@]} -gt 0 ]]; then echo "env-sync: commented out obsolete ${obsolete[*]}"; fi
  if [[ $secret_set -eq 1 ]]; then echo "env-sync: generated BETTER_AUTH_SECRET"; fi
  if [[ $key_set -eq 1 ]]; then echo "env-sync: generated EDULIMS_DATA_KEY"; fi
  if [[ ${#added[@]} -eq 0 && ${#obsolete[@]} -eq 0 && $secret_set -eq 0 && $key_set -eq 0 ]]; then
    echo "env-sync: already up to date"
  fi
}

self_test() {
  local work
  work=$(mktemp -d)
  trap 'rm -rf "$work"' RETURN
  printf 'A=1\nBETTER_AUTH_SECRET=\nEDULIMS_DATA_KEY=\n# C=commented\nB=two\nNODE_ENV=development\n' > "$work/example"
  printf 'A=mine\nNODE_ENV=development\nBETTER_AUTH_SECRET=keep\n' > "$work/target"

  sync "$work/target" "$work/example" > "$work/out"
  grep -qx 'A=mine' "$work/target" || { echo "self-test: an existing value changed" >&2; return 1; }
  grep -qx 'B=two' "$work/target" || { echo "self-test: a missing variable was not added" >&2; return 1; }
  grep -qx 'BETTER_AUTH_SECRET=keep' "$work/target" || { echo "self-test: a set secret changed" >&2; return 1; }
  grep -q '^C=' "$work/target" && { echo "self-test: a commented example line was added" >&2; return 1; }
  grep -qx '# NODE_ENV=development' "$work/target" || { echo "self-test: obsolete NODE_ENV not commented out" >&2; return 1; }
  grep -q 'mine\|keep\|development' "$work/out" && { echo "self-test: a value was printed" >&2; return 1; }

  sync "$work/target" "$work/example" | grep -q 'already up to date' || { echo "self-test: a second run changed something" >&2; return 1; }

  rm -f "$work/target"
  sync "$work/target" "$work/example" > /dev/null
  grep -qE '^BETTER_AUTH_SECRET=[0-9a-f]{64}$' "$work/target" || { echo "self-test: no secret generated for a new file" >&2; return 1; }
  grep -qE '^EDULIMS_DATA_KEY=[A-Za-z0-9+/]{43}=$' "$work/target" || { echo "self-test: no data key generated for a new file" >&2; return 1; }
  [[ "$(stat -c %a "$work/target" 2>/dev/null || stat -f %Lp "$work/target")" == 600 ]] || { echo "self-test: new file is not mode 600" >&2; return 1; }
  echo "env-sync: self-test passed"
}

root=$(cd "$(dirname "$0")/../.." && pwd)
target="$root/.env"
example="$root/.env.example"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help | -h) usage; exit 0 ;;
    --self-test) self_test; exit $? ;;
    --env) target=$2; shift 2 ;;
    --example) example=$2; shift 2 ;;
    *) usage >&2; exit 2 ;;
  esac
done
sync "$target" "$example"
