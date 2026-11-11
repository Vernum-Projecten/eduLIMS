#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Installs the pnpm version package.json pins (`packageManager`) from the npm
# registry, checked against the integrity pinned below, for the publishing
# lanes. Node.js 25 removed corepack, so pnpm no longer arrives with Node.js.
#
#   scripts/release/install-pnpm.sh
#   scripts/release/install-pnpm.sh --integrity <version>   # print the pin, or fail
#
# A version with no row below is refused: a pnpm bump adds its row, the
# `dist.integrity` that `npm view pnpm@<version> dist.integrity` prints. The
# same value is the PNPM_INTEGRITY build argument in docker/Dockerfile.
set -euo pipefail

# One "version<TAB>integrity" row per line.
readonly INTEGRITY="\
12.18.0	sha512-nXiC1dyCFH7PxOBiqjSDTgrQKWcQoYN6ERWuASEn02txCeMhrBWYod0KZVl2gbHpmRfhLtDXSerpEYeUM2O+sw=="

die() {
  printf 'install-pnpm: %s\n' "$1" >&2
  exit 1
}

pinned() {
  awk -F'\t' -v want="$1" '$1 == want { print $2; found = 1 } END { exit !found }' <<<"$INTEGRITY"
}

if [[ "${1:-}" == "--integrity" ]]; then
  [[ $# -eq 2 ]] || die "usage: $0 --integrity <version>"
  pinned "$2" || die "no integrity is pinned for pnpm $2"
  exit 0
fi
[[ $# -eq 0 ]] || die "usage: $0 | $0 --integrity <version>"

root="$(cd "$(dirname "$0")/../.." && pwd)"
version="$(node -p 'require(process.argv[1]).packageManager.replace(/^pnpm@/, "")' "$root/package.json")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "package.json packageManager pins no exact pnpm version: $version"
want="$(pinned "$version")" || die "no integrity is pinned for pnpm $version; add its row to $0"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# npm runs outside the checkout: there the `devEngines` field of package.json
# names pnpm, and npm refuses to run.
cd "$work"
tarball="$(npm pack --silent "pnpm@${version}")"
got="sha512-$(openssl dgst -sha512 -binary "$tarball" | openssl base64 -A)"
[[ "$got" == "$want" ]] || die "pnpm-${version}.tgz has integrity $got, and $want is pinned"
npm install --global --no-audit --no-fund "./$tarball"
pnpm --version
