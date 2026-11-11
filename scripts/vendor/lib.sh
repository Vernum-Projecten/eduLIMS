#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# The shared half of the scripts/vendor/owasp-*.sh fetch scripts. A fetch
# script sets the variables below and calls `vendor_main "$@"`; this file
# fetches every listed file from raw.githubusercontent.com at the pinned
# commit, verifies its sha256, and writes the tree and its PROVENANCE.md.
#
#   NAME      the directory under docs/security/vendor/
#   TITLE     the document's name, for PROVENANCE.md
#   REPO      owner/name on GitHub
#   TAG       the release tag, or "" when upstream publishes no tag
#   COMMIT    the full commit SHA the tag resolves to (or the pinned commit)
#   FETCHED   the date the pin was taken (YYYY-MM-DD)
#   STRIP     the upstream path prefix dropped from the local path
#   LICENCE   the SPDX id of the upstream licence
#   CONSUMER  who reads the copy, one sentence
#   FILES     one "<sha256>  <upstream path>" line per file
#
# Modes:
#   (none)    fetch, verify, and replace docs/security/vendor/<NAME>/
#   --check   fetch into a temporary directory, verify, and diff it against
#             the committed tree; also checks that TAG still names COMMIT
#   --sums    print fresh "<sha256>  <path>" lines for FILES at COMMIT, for
#             a pin update (paste them into the script, then run it)
#
# Exit status: 0 ok, 1 a sum, a tag or the committed tree does not match,
# 2 a usage or network error.
set -euo pipefail

vendor_die() {
  printf '%s: %s\n' "$NAME" "$1" >&2
  exit "${2:-2}"
}

vendor_sha256() {
  if command -v sha256sum >/dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

vendor_local_path() {
  local path="$1"
  if [[ -n "$STRIP" && "$path" == "$STRIP"* ]]; then
    printf '%s' "${path#"$STRIP"}"
  else
    printf '%s' "$path"
  fi
}

vendor_fetch() {
  local path="$1" out="$2"
  mkdir -p "$(dirname "$out")"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --retry 3 --user-agent 'edulims-vendor-fetch' --output "$out" \
    "https://raw.githubusercontent.com/${REPO}/${COMMIT}/${path}" ||
    vendor_die "could not fetch ${path} at ${COMMIT}"
}

# Fetches every file in FILES into $1 and verifies its sum; returns 1 on a mismatch.
vendor_fetch_all() {
  local dir="$1" want path local_path got bad=0
  while read -r want path; do
    [[ -n "$path" ]] || continue
    local_path="$(vendor_local_path "$path")"
    vendor_fetch "$path" "$dir/$local_path"
    got="$(vendor_sha256 "$dir/$local_path")"
    if [[ "$got" != "$want" ]]; then
      printf '%s: %s has sha256 %s, and %s is pinned\n' "$NAME" "$path" "$got" "$want" >&2
      bad=1
    fi
  done <<<"$FILES"
  return "$bad"
}

# Writes PROVENANCE.md into $1 from the pins; deterministic, so --check can diff it.
# shellcheck disable=SC2016 # the backticks are Markdown code spans, not command substitution
vendor_provenance() {
  local dir="$1" want path ref
  if [[ -n "$TAG" ]]; then
    ref="tag \`${TAG}\` (commit \`${COMMIT}\`)"
  else
    ref="commit \`${COMMIT}\` (upstream publishes no release tag for this edition)"
  fi
  {
    printf '<!-- SPDX-FileCopyrightText: Ruben Talstra -->\n'
    printf '<!-- SPDX-License-Identifier: Apache-2.0 -->\n\n'
    printf '# Provenance: %s\n\n' "$TITLE"
    printf 'Written by `scripts/vendor/owasp-%s.sh`. Never hand-edit this file or a\n' "$NAME"
    printf 'file beside it: change the pins in the script and re-run it.\n\n'
    printf -- '- Upstream: <https://github.com/%s>\n' "$REPO"
    printf -- '- Ref: %s\n' "$ref"
    printf -- '- Fetched: %s, from\n' "$FETCHED"
    printf '  `https://raw.githubusercontent.com/%s/%s/<upstream path>`\n' "$REPO" "$COMMIT"
    printf -- '- Licence: %s, the upstream licence file is alongside; the text is\n' "$LICENCE"
    printf '  `LICENSES/%s.txt` and `REUSE.toml` annotates this tree.\n' "$LICENCE"
    printf -- '- Consumer: %s\n' "$CONSUMER"
    printf -- '- Check: `bash scripts/vendor/owasp-%s.sh --check` re-fetches and diffs.\n\n' "$NAME"
    printf '## Files\n\n'
    printf '| File | Upstream path | sha256 |\n|---|---|---|\n'
    while read -r want path; do
      [[ -n "$path" ]] || continue
      printf '| `%s` | `%s` | `%s` |\n' "$(vendor_local_path "$path")" "$path" "$want"
    done <<<"$FILES"
  } >"$dir/PROVENANCE.md"
}

vendor_check_tag() {
  [[ -n "$TAG" ]] || return 0
  local refs resolved
  refs="$(git ls-remote "https://github.com/${REPO}.git" "refs/tags/${TAG}" "refs/tags/${TAG}^{}")" ||
    vendor_die "could not list the tags of ${REPO}"
  # An annotated tag lists its peeled commit as <tag>^{}; a lightweight tag lists the commit.
  resolved="$(awk -v t="refs/tags/${TAG}^{}" '$2 == t { print $1 }' <<<"$refs")"
  [[ -n "$resolved" ]] || resolved="$(awk -v t="refs/tags/${TAG}" '$2 == t { print $1 }' <<<"$refs")"
  [[ -n "$resolved" ]] || vendor_die "tag ${TAG} is gone from ${REPO}" 1
  [[ "$resolved" == "$COMMIT" ]] ||
    vendor_die "tag ${TAG} now names ${resolved}, and ${COMMIT} is pinned" 1
}

vendor_main() {
  local root dest work
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  dest="$root/docs/security/vendor/$NAME"
  [[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || vendor_die "COMMIT must be a full 40-character SHA"
  work="$(mktemp -d)"
  # shellcheck disable=SC2064 # expand now: $work is local and gone when the trap fires
  trap "rm -rf '$work'" EXIT

  case "${1:-}" in
    "")
      vendor_fetch_all "$work/tree" || vendor_die "a fetched file does not match its pinned sum" 1
      vendor_provenance "$work/tree"
      rm -rf "$dest"
      mkdir -p "$(dirname "$dest")"
      cp -R "$work/tree" "$dest"
      printf '%s: %s files at %s into %s\n' "$NAME" "$(grep -c . <<<"$FILES")" \
        "${TAG:-$COMMIT}" "${dest#"$root/"}"
      ;;
    --check)
      vendor_check_tag
      vendor_fetch_all "$work/tree" || vendor_die "a fetched file does not match its pinned sum" 1
      vendor_provenance "$work/tree"
      if ! diff -r "$work/tree" "$dest" >"$work/diff"; then
        cat "$work/diff" >&2
        vendor_die "the committed tree differs from upstream; re-run the script" 1
      fi
      printf '%s: the committed tree matches %s\n' "$NAME" "${TAG:-$COMMIT}"
      ;;
    --sums)
      local want path
      while read -r want path; do
        [[ -n "$path" ]] || continue
        vendor_fetch "$path" "$work/file"
        printf '%s  %s\n' "$(vendor_sha256 "$work/file")" "$path"
      done <<<"$FILES"
      ;;
    *) vendor_die "usage: $0 [--check | --sums]" ;;
  esac
}
