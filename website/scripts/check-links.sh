#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Checks every link and anchor inside the built site (website/dist) with
# lychee, offline: a link to a page, an asset or a heading that the build did
# not produce fails. External reachability is not checked here, because a
# remote host that rate-limits a runner says nothing about the change under
# review. Links to https://edulims.eu itself are skipped too: the site is
# what this build produces, and a pull request's pages are not deployed yet.
#
#   website/scripts/check-links.sh        # lychee from PATH or website/.bin
set -euo pipefail
cd "$(dirname "$0")/.."

lychee_bin="$(command -v lychee || true)"
if [[ -z "$lychee_bin" ]]; then
  lychee_bin=".bin/lychee"
  [[ -x "$lychee_bin" ]] || bash scripts/install-lychee.sh .bin
fi
[[ -f dist/index.html ]] || {
  printf 'check-links: no dist/index.html; run the build first\n' >&2
  exit 1
}

"$lychee_bin" --offline --no-progress --include-fragments \
  --root-dir "$PWD/dist" --index-files index.html \
  --exclude '^https://edulims\.eu' \
  'dist/**/*.html'
