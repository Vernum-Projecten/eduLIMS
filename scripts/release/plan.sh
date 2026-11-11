#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Every release fact, checked at the tagged commit before anything is built.
# The release workflow's `plan` job runs it at the tag, and you run it before
# you push the tag (docs/release.md), so a cut the workflow would refuse fails
# on your machine first.
#
#   scripts/release/plan.sh <tag> [--notes FILE]
#
# It checks that:
#   - <tag> is vX.Y.Z or vX.Y.Z-<pre-release>;
#   - package.json (and CITATION.cff, when present) hold X.Y.Z;
#   - no fragment is left under changelog.d/, so the cut assembled them all;
#   - CHANGELOG.md keeps the Keep a Changelog structure and has a
#     "## [X.Y.Z] - YYYY-MM-DD" section with at least one entry;
#   - the milestone titled <tag> exists and holds no open item (skipped for a
#     pre-release; needs gh authenticated).
#
# With --notes it writes the release notes to FILE: the changelog section,
# then how to verify the release's artifacts.
set -euo pipefail
export LC_ALL=C

usage() {
  echo "usage: plan.sh <tag> [--notes FILE]" >&2
  exit 2
}

[[ $# -eq 1 || ($# -eq 3 && "$2" == --notes) ]] || usage
tag="$1"
notes_file="${3:-}"
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../.."

fail() {
  echo "::error::plan: $*" >&2
  exit 1
}

[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || fail "'$tag' is not a vX.Y.Z tag"
version="${tag#v}"

bash "$here/version.sh" --check "$version" || fail "run scripts/release/version.sh ${version} and commit before tagging"

bash "$here/changelog.sh" --check > /dev/null
left="$(find changelog.d -maxdepth 1 -type f ! -name README.md | sort)"
[[ -z "$left" ]] || fail "changelog.d/ still holds fragments; run scripts/release/changelog.sh --assemble ${version} <date> before tagging: $(tr '\n' ' ' <<<"$left")"

bash "$here/changelog.sh" --structure CHANGELOG.md
section="$(bash "$here/changelog.sh" --notes "$version")" || fail "CHANGELOG.md has no '## [${version}] - YYYY-MM-DD' section"
grep -q '^- ' <<<"$section" || fail "the [${version}] section of CHANGELOG.md holds no entry"

bash "$here/milestone.sh" check "$tag"

if [[ -n "$notes_file" ]]; then
  repo="${GITHUB_REPOSITORY:-Vernum-Projecten/eduLIMS}"
  # shellcheck disable=SC2016 # the backticks are Markdown in the notes, not a command
  {
    printf '%s\n\n' "$section"
    printf '## Verify this release\n\n'
    printf 'The images are published by digest and tagged `%s` only after their scan passed.\n' "$version"
    printf 'Verify an image and the server tarball before you deploy them:\n\n'
    printf '```sh\n'
    printf 'gh attestation verify oci://ghcr.io/vernum-projecten/edulims:%s \\\n' "$version"
    printf '  --repo %s \\\n' "$repo"
    printf '  --signer-workflow %s/.github/workflows/release-image.yml\n' "$repo"
    printf 'gh attestation verify edulims-%s.tar.gz \\\n' "$tag"
    printf '  --repo %s \\\n' "$repo"
    printf '  --signer-workflow %s/.github/workflows/release-build.yml\n' "$repo"
    printf '```\n\n'
    printf 'The vulnerability record of this release is the asset `edulims-%s-vulnerability-record.json`.\n' "$tag"
  } > "$notes_file"
  echo "plan: the release notes are in ${notes_file}."
fi
echo "plan: every release fact holds for ${tag}."
