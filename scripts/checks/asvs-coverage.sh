#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Fails when docs/security/asvs-5.0-applicability.md misses an ASVS 5.0.0
# requirement id, names an id the vendored list does not have, lists one
# twice, keeps a TODO cell, or has Applies and Status that disagree. The list
# is the vendored flat JSON (scripts/vendor/owasp-asvs.sh); the check needs
# Node.js only, no install and no network.
#
#   bash scripts/checks/asvs-coverage.sh              # check the table
#   bash scripts/checks/asvs-coverage.sh --self-test  # prove it refuses broken tables
set -euo pipefail
cd "$(dirname "$0")/../.."

readonly TABLE="docs/security/asvs-5.0-applicability.md"

check() {
  node scripts/security/asvs-table.ts --check
}

self_test() {
  local work status=0
  work="$(mktemp -d)"
  # shellcheck disable=SC2064 # expand now: $work is local and gone when the trap fires
  trap "rm -rf '$work'" EXIT

  expect_failure() {
    local label="$1" file="$2"
    if ASVS_TABLE="$file" node scripts/security/asvs-table.ts --check >/dev/null 2>&1; then
      printf 'asvs-coverage self-test: a table with %s passed\n' "$label" >&2
      status=1
    fi
  }

  grep -v '^| V6\.8\.1 |' "$TABLE" >"$work/missing.md"
  expect_failure "a missing id" "$work/missing.md"

  sed '/^| V6\.8\.1 |/{p;s/V6\.8\.1/V6.8.99/;}' "$TABLE" >"$work/unknown.md"
  expect_failure "an unknown id" "$work/unknown.md"

  sed '/^| V6\.8\.1 |/p' "$TABLE" >"$work/twice.md"
  expect_failure "an id listed twice" "$work/twice.md"

  sed 's/^\(| V6\.8\.1 | 2 | [^|]* |\)[^|]*|/\1 TODO |/' "$TABLE" >"$work/todo.md"
  expect_failure "a TODO cell" "$work/todo.md"

  sed 's/^\(| V17\.1\.1 | 2 | no |.*| \)n-a |$/\1met |/' "$TABLE" >"$work/disagree.md"
  expect_failure "applies no with status met" "$work/disagree.md"

  check >/dev/null
  [[ "$status" -eq 0 ]] && echo "asvs-coverage self-test: ok"
  return "$status"
}

case "${1:-}" in
  "") check ;;
  --self-test) self_test ;;
  *)
    printf 'usage: %s [--self-test]\n' "$0" >&2
    exit 2
    ;;
esac
