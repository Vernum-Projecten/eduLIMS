#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# Every tool and runtime pin no Dependabot ecosystem reads, compared with its
# newest upstream release (no specification governs this: our own design,
# ported from the Ferro family).
#
# Dependabot moves the `uses:` references, the npm dependencies, and the base
# images under docker/. It does not read:
#   * the Node.js release in .node-version (held to its major line, because a
#     new major is a decision and not a bump);
#   * the pnpm release in package.json `packageManager`;
#   * the PostgreSQL service image the e2e job of ci.yml runs (held to its
#     major line);
#   * actionlint, zizmor, and shellcheck, which ci.yml pins by version.
#
#   scripts/checks/pin-freshness.sh
#   scripts/checks/pin-freshness.sh --self-test
#
# Needs an authenticated `gh`, curl and jq. `--self-test` runs the readers over
# fixtures and needs no network.
#
# Exit 0 when every pin is current, 1 when at least one is behind (each such
# line starts with STALE), 2 when a pin or a release could not be read, so a
# network failure never reads as a fresh pin.
set -euo pipefail

ROOT="${PIN_FRESHNESS_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
FIXTURES="${PIN_FRESHNESS_FIXTURES:-}"
readonly CURL=(curl -fsSL --proto "=https" --tlsv1.2 --retry 3 --retry-delay 2)

# fetch <name> <command...>: the fixture of that name in a self-test, else
# the command's output.
fetch() {
  local name=$1
  shift
  if [[ -n "$FIXTURES" ]]; then
    cat "$FIXTURES/$name"
  else
    "$@"
  fi
}

latest_release() {
  fetch "release-${1//\//_}" gh api "repos/$1/releases/latest" --jq .tag_name | sed 's/^v//'
}

# The newest Node.js release of major line $1.
latest_node() {
  fetch node "${CURL[@]}" https://nodejs.org/dist/index.json |
    jq -r --arg m "v$1." '[.[] | select(.version | startswith($m)) | .version] | first // empty' | sed 's/^v//'
}

latest_pnpm() {
  fetch pnpm "${CURL[@]}" https://registry.npmjs.org/pnpm/latest | jq -r '.version // empty'
}

# The newest `<major>.<minor>-alpine` tag of the postgres image on Docker Hub.
latest_postgres() {
  fetch postgres "${CURL[@]}" "https://hub.docker.com/v2/repositories/library/postgres/tags?page_size=100&name=$1." |
    jq -r '.results[].name' | grep -E "^$1\.[0-9]+-alpine$" | sed 's/-alpine$//' | sort -V | tail -n1
}

# pin <file> <ERE with one group>: the first match of the group in the file.
pin() {
  sed -nE "s|.*$2.*|\1|p" "$ROOT/$1" | head -n1
}

status=0
# compare <label> <pinned> <latest>
compare() {
  local label=$1 pinned=$2 latest=$3
  if [[ -z "$pinned" || -z "$latest" ]]; then
    echo "UNREAD $label: pinned '${pinned}', newest '${latest}'"
    status=2
  elif [[ "$pinned" == "$latest" ]]; then
    echo "ok     $label $pinned"
  elif [[ "$(printf '%s\n%s\n' "$pinned" "$latest" | sort -V | tail -n1)" == "$pinned" ]]; then
    echo "ok     $label $pinned (ahead of $latest)"
  else
    echo "STALE  $label $pinned, newest $latest"
    [[ "$status" -eq 2 ]] || status=1
  fi
}

check() {
  local node pnpm postgres actionlint zizmor shellcheck
  node="$(tr -d ' \nv' < "$ROOT/.node-version")"
  compare "Node.js (.node-version)" "$node" "$(latest_node "${node%%.*}" || true)"
  pnpm="$(jq -r '.packageManager // empty' "$ROOT/package.json" | sed -nE 's/^pnpm@([0-9.]+).*/\1/p')"
  compare "pnpm (packageManager)" "$pnpm" "$(latest_pnpm || true)"
  postgres="$(pin .github/workflows/ci.yml 'image: postgres:([0-9]+\.[0-9]+)-alpine@')"
  compare "PostgreSQL (ci.yml e2e service)" "$postgres" "$(latest_postgres "${postgres%%.*}" || true)"
  actionlint="$(pin .github/workflows/ci.yml 'rhysd/actionlint:([0-9.]+)@')"
  compare "actionlint (ci.yml)" "$actionlint" "$(latest_release rhysd/actionlint || true)"
  zizmor="$(pin .github/workflows/ci.yml 'tool: zizmor@([0-9.]+)')"
  compare "zizmor (ci.yml)" "$zizmor" "$(latest_release zizmorcore/zizmor || true)"
  shellcheck="$(pin .github/workflows/ci.yml 'tool: shellcheck@([0-9.]+)')"
  compare "shellcheck (ci.yml)" "$shellcheck" "$(latest_release koalaman/shellcheck || true)"
  return "$status"
}

self_test() {
  local work rc
  work="$(mktemp -d)"
  mkdir -p "$work/root/.github/workflows" "$work/fx"
  printf '26.13.0\n' > "$work/root/.node-version"
  printf '{"packageManager":"pnpm@12.18.0"}\n' > "$work/root/package.json"
  cat > "$work/root/.github/workflows/ci.yml" <<'YAML'
        image: postgres:18.6-alpine@sha256:0000
            rhysd/actionlint:1.7.12@sha256:0000 \
          tool: zizmor@1.32.0
          tool: shellcheck@0.11.0
YAML
  printf '[{"version":"v27.0.0"},{"version":"v26.13.0"},{"version":"v26.12.1"}]' > "$work/fx/node"
  printf '{"version":"12.18.0"}' > "$work/fx/pnpm"
  printf '{"results":[{"name":"18.6-alpine"},{"name":"18.6"},{"name":"18.5-alpine"},{"name":"18-alpine"}]}' > "$work/fx/postgres"
  printf 'v1.7.12\n' > "$work/fx/release-rhysd_actionlint"
  printf 'v1.32.0\n' > "$work/fx/release-zizmorcore_zizmor"
  printf 'v0.11.0\n' > "$work/fx/release-koalaman_shellcheck"

  expect() {
    local name=$1 want=$2 needle=$3
    rc=0
    PIN_FRESHNESS_ROOT="$work/root" PIN_FRESHNESS_FIXTURES="$work/fx" bash "$0" > "$work/out" 2>&1 || rc=$?
    if [[ "$rc" -ne "$want" ]] || ! grep -qF -- "$needle" "$work/out"; then
      echo "pin-freshness: self-test failed: $name exited $rc (wanted $want) or did not say '$needle'." >&2
      cat "$work/out" >&2
      exit 1
    fi
  }
  expect "every pin current, a new Node major ignored" 0 "ok     Node.js (.node-version) 26.13.0"
  printf 'v1.33.0\n' > "$work/fx/release-zizmorcore_zizmor"
  expect "a tool behind its release" 1 "STALE  zizmor (ci.yml) 1.32.0, newest 1.33.0"
  printf '{"results":[{"name":"18.10-alpine"},{"name":"18.6-alpine"}]}' > "$work/fx/postgres"
  expect "a postgres minor compared by version, not text" 1 "STALE  PostgreSQL (ci.yml e2e service) 18.6, newest 18.10"
  : > "$work/fx/pnpm"
  expect "an unreadable release" 2 "UNREAD pnpm (packageManager)"
  rm -r "$work"
  echo "pin-freshness: self-test OK."
}

case "$#:${1:-}" in
  1:--self-test) self_test ;;
  0:) check ;;
  *)
    echo "usage: pin-freshness.sh [--self-test]" >&2
    exit 2
    ;;
esac
