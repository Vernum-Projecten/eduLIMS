#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Packs the built `.output/` tree into the release tarball, and stages a
# tarball as the `dist/.output` build input of docker/Dockerfile (OUTPUT=dist).
# release-build.yml packs, release-image.yml stages, and the CI image lane does
# both in one run, so the release lane's inputs are built before a tag (#221).
#
#   scripts/release/output.sh pack <tarball>    # .output -> <tarball> and <tarball>.sha256sum
#   scripts/release/output.sh stage <tarball>   # <tarball> -> dist/.output
#
# Run from the repository root, after `pnpm build`.
set -euo pipefail

die() {
  printf 'output: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 2 ]] || die "usage: output.sh pack|stage <tarball>"
tarball="$2"

case "$1" in
  pack)
    [[ -f .output/server/index.mjs ]] || die "no .output/server/index.mjs; run pnpm build first"
    # Fixed owner, mode and order, and the commit time as every mtime, so the
    # tarball's bytes depend on the tree alone.
    epoch="$(git log -1 --format=%ct)"
    tar --sort=name --owner=0 --group=0 --numeric-owner \
      --mtime="@${epoch}" --mode='u+rwX,go+rX,go-w' \
      -czf "$tarball" .output
    sha256sum "$tarball" >"${tarball}.sha256sum"
    cat "${tarball}.sha256sum"
    ;;
  stage)
    [[ -f "$tarball" ]] || die "no tarball at ${tarball}"
    [[ ! -e dist/.output ]] || die "dist/.output exists already; stage into a clean checkout"
    mkdir -p dist
    tar -C dist -xzf "$tarball"
    [[ -f dist/.output/server/index.mjs ]] || die "${tarball} holds no .output/server/index.mjs"
    ;;
  *)
    die "unknown command $1; use pack or stage"
    ;;
esac
