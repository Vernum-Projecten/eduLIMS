#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Installs the pinned lychee link checker from its GitHub release tarball,
# verified against the sha256 below, into <bindir>, and puts <bindir> on
# GITHUB_PATH in a workflow.
#
#   website/scripts/install-lychee.sh <bindir>
#
# Pinned platforms: Linux x86_64 (the GitHub runner) and macOS arm64. A bump
# changes LYCHEE_VERSION and both rows, read from the release's
# lychee-<target>.tar.gz.sha256 assets.
set -euo pipefail

readonly LYCHEE_VERSION="0.24.2"

# One "target<TAB>sha256 of lychee-<target>.tar.gz" row per platform.
readonly CHECKSUMS="\
x86_64-unknown-linux-gnu	1f4e0ef7f6554a6ed33dd7ac144fb2e1bbed98598e7af973042fc5cd43951c9a
aarch64-apple-darwin	c9d3740ea2d891854d37116c9fba840f37b6e7c89d330e7db84ac333631c4977"

die() {
  printf 'install-lychee: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 1 ]] || die "usage: $0 <bindir>"
bindir="$1"

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) target="x86_64-unknown-linux-gnu" ;;
  Darwin/arm64) target="aarch64-apple-darwin" ;;
  *) die "no lychee binary is pinned for $(uname -s) $(uname -m)" ;;
esac
want="$(awk -F'\t' -v t="$target" '$1 == t { print $2 }' <<<"$CHECKSUMS")"

tarball="lychee-${target}.tar.gz"
url="https://github.com/lycheeverse/lychee/releases/download/lychee-v${LYCHEE_VERSION}/${tarball}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --retry 3 --output "$work/$tarball" "$url"
if command -v sha256sum >/dev/null; then
  got="$(sha256sum "$work/$tarball" | cut -d' ' -f1)"
else
  got="$(shasum -a 256 "$work/$tarball" | cut -d' ' -f1)"
fi
[[ "$got" == "$want" ]] || die "$tarball has sha256 $got, and $want is pinned"

mkdir -p "$bindir"
tar -xzf "$work/$tarball" -C "$work" "lychee-${target}/lychee"
install -m 0755 "$work/lychee-${target}/lychee" "$bindir/lychee"
"$bindir/lychee" --version
if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "$bindir" >>"$GITHUB_PATH"
fi
