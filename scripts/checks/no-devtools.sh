#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Proves a production build ships none of the TanStack Devtools (#64): the
# client assets under .output/public/assets must hold no devtools chunk and
# none of the markers the devtools packages and our panel bring along. Run it
# after `pnpm build` (NODE_ENV=production).
#
#   scripts/checks/no-devtools.sh              # check .output/public/assets
#   scripts/checks/no-devtools.sh <dir>        # check another assets directory
#   scripts/checks/no-devtools.sh --self-test  # prove the check refuses a leak
#
# The markers: `tsrd-` and `tsqd-` are the CSS class prefixes of the Router and
# Query panels, `@tanstack/devtools` the core's package name, `TanStack Router`
# and `TanStack Form` the plugin names in src/components/devtools/app-devtools.tsx,
# `app-devtools` the name of its chunk. TanStack Form's own event client
# (`tanstack-devtools-global`) is part of @tanstack/form-core in every build and
# is not a marker: it renders nothing and only talks to a panel that is absent.
set -euo pipefail

MARKERS=("tsrd-" "tsqd-" "@tanstack/devtools" "TanStack Router" "TanStack Form" "app-devtools")

check() {
  local dir=$1 found=0 marker hits
  if [[ ! -d "$dir" ]]; then
    echo "no-devtools: $dir does not exist; run \`NODE_ENV=production pnpm build\` first" >&2
    return 2
  fi
  if ! compgen -G "$dir/*.js" >/dev/null; then
    echo "no-devtools: $dir holds no JavaScript; is it the client assets directory?" >&2
    return 2
  fi
  for marker in "${MARKERS[@]}"; do
    hits=$(grep -rlF -- "$marker" "$dir" || true)
    if [[ -n "$hits" ]]; then
      echo "no-devtools: '$marker' found in:" >&2
      printf '  %s\n' "$hits" >&2
      found=1
    fi
  done
  hits=$(find "$dir" -iname '*devtools*' -print)
  if [[ -n "$hits" ]]; then
    echo "no-devtools: devtools chunk in the build:" >&2
    printf '  %s\n' "$hits" >&2
    found=1
  fi
  if ((found)); then
    echo "no-devtools: FAIL, the production client bundle contains devtools code" >&2
    return 1
  fi
  echo "no-devtools: ok, no devtools code in $dir"
}

self_test() {
  local scratch status
  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' RETURN
  printf 'export const a=1;\n' >"$scratch/index-abc.js"
  check "$scratch" >/dev/null || { echo "self-test: a clean bundle was refused" >&2; return 1; }

  printf 'const p={name:"TanStack Router"};\n' >"$scratch/main-def.js"
  status=0
  check "$scratch" >/dev/null 2>&1 || status=$?
  [[ $status -eq 1 ]] || { echo "self-test: a plugin marker was not refused" >&2; return 1; }

  rm "$scratch/main-def.js"
  printf 'export{};\n' >"$scratch/app-devtools-XyZ.js"
  status=0
  check "$scratch" >/dev/null 2>&1 || status=$?
  [[ $status -eq 1 ]] || { echo "self-test: a devtools chunk was not refused" >&2; return 1; }

  status=0
  check "$scratch/missing" >/dev/null 2>&1 || status=$?
  [[ $status -eq 2 ]] || { echo "self-test: a missing directory was not refused" >&2; return 1; }
  echo "no-devtools: self-test ok"
}

case "${1:-}" in
  --self-test) self_test ;;
  "") check ".output/public/assets" ;;
  *) check "$1" ;;
esac
