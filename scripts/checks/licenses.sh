#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# The dependency license guard: every production dependency pnpm resolves
# carries a license scripts/checks/licenses.allow names.
#
# A license expression passes when one of its OR alternatives passes, and an
# alternative passes when every AND term in it is on the list. A `WITH`
# exception is read as its base license. No specification governs the policy:
# it is our own design, and the list says why each entry is there.
#
# Usage:
#   scripts/checks/licenses.sh
#       Reads `pnpm licenses list --prod --json` from the installed tree.
#   scripts/checks/licenses.sh --input <file>
#       Reads that JSON instead (the shape `pnpm licenses list --json` writes).
#   scripts/checks/licenses.sh --self-test
#       Judges fixtures and needs no install.
#
# Exit 0 when every license passes, 1 when one does not (each such line starts
# with DENIED), 2 on a usage error.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOW="${LICENSES_ALLOW:-$here/licenses.allow}"

usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

# allowed <id>: the identifier is on the list.
allowed() {
  grep -v '^#' "$ALLOW" | grep -qxF -- "$1"
}

# passes <expression>: the SPDX expression holds under the list.
passes() {
  local expression="$1" alternative term ok
  expression="${expression//(/}"
  expression="${expression//)/}"
  while IFS= read -r alternative; do
    ok=1
    while IFS= read -r term; do
      term="${term%% WITH *}"
      term="$(printf '%s' "$term" | sed 's/^ *//; s/ *$//')"
      [[ -n "$term" ]] || continue
      # A few packages spell an SPDX id out in package.json; map only those exact
      # spellings, checked against the package's LICENSE file when added.
      case "$term" in
        "MIT License") term="MIT" ;; # xml-escape 1.1.0 (through samlify)
      esac
      allowed "$term" || ok=0
    done <<<"${alternative// AND /$'\n'}"
    [[ "$ok" -eq 1 ]] && return 0
  done <<<"${expression// OR /$'\n'}"
  return 1
}

judge() {
  local input="$1" license names denied=0
  command -v jq >/dev/null 2>&1 || { echo "licenses: jq is not installed" >&2; exit 2; }
  while IFS= read -r license; do
    if passes "$license"; then
      echo "ok: $license"
    else
      names="$(jq -r --arg l "$license" '.[$l] | map("\(.name)@\(.versions | join(","))") | join(" ")' "$input")"
      echo "DENIED: $license ($names)"
      denied=1
    fi
  done < <(jq -r 'keys[]' "$input")
  if [[ "$denied" -ne 0 ]]; then
    echo "::error::a dependency carries a license scripts/checks/licenses.allow does not name" >&2
    return 1
  fi
}

self_test() {
  local work rc
  work="$(mktemp -d)"
  trap 'rm -r -- "$work"' RETURN
  expect() {
    local name=$1 want=$2 json=$3
    printf '%s' "$json" > "$work/in.json"
    rc=0
    judge "$work/in.json" > "$work/out" 2>&1 || rc=$?
    if [[ "$rc" -ne "$want" ]]; then
      echo "licenses: self-test failed: $name exited $rc, wanted $want." >&2
      cat "$work/out" >&2
      exit 1
    fi
  }
  expect "permissive licenses" 0 '{"MIT":[{"name":"a","versions":["1"]}],"Apache-2.0":[{"name":"b","versions":["2"]}]}'
  expect "an OR with one allowed alternative" 0 '{"(MIT OR GPL-3.0-only)":[{"name":"a","versions":["1"]}]}'
  expect "an AND with every term allowed" 0 '{"(MIT AND BSD-3-Clause)":[{"name":"a","versions":["1"]}]}'
  expect "a WITH exception on an allowed base" 0 '{"Apache-2.0 WITH LLVM-exception":[{"name":"a","versions":["1"]}]}'
  expect "a strong copyleft license" 1 '{"GPL-3.0-only":[{"name":"evil","versions":["1"]}]}'
  grep -q 'DENIED: GPL-3.0-only (evil@1)' "$work/out" || {
    echo "licenses: self-test failed: the refusal did not name the package." >&2
    exit 1
  }
  expect "an AND with one term denied" 1 '{"(MIT AND AGPL-3.0-only)":[{"name":"a","versions":["1"]}]}'
  expect "an unknown license" 1 '{"Unknown":[{"name":"a","versions":["1"]}]}'
  expect "the spelled-out MIT License" 0 '{"MIT License":[{"name":"a","versions":["1"]}]}'
  expect "another spelled-out license" 1 '{"GPL License":[{"name":"a","versions":["1"]}]}'
  expect "a prefix of an allowed id" 1 '{"MIT-Modern-Variant-X":[{"name":"a","versions":["1"]}]}'
  echo "licenses: self-test OK."
}

case "$#:${1:-}" in
  1:--self-test)
    self_test
    exit 0
    ;;
  2:--input)
    judge "$2"
    ;;
  0:)
    cd "$here/../.."
    tmp="$(mktemp)"
    trap 'rm -f -- "$tmp"' EXIT
    pnpm licenses list --prod --json > "$tmp"
    judge "$tmp"
    ;;
  *) usage ;;
esac
