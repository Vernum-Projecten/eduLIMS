#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# scripts/gh/labels.sh: sync the repository's labels to .github/labels.yml.
#
# .github/labels.yml is the single source of the taxonomy. This program
# creates a label it lists and the repository lacks, updates one whose colour
# or description differs, deletes a name the file retires, and leaves every
# other label alone. Running it twice changes nothing the second time.
#
# Taxonomy policy: no specification governs it: our own design, ported from
# the Ferro family.
# Official docs: https://cli.github.com/manual/gh_label_create
#
# Usage:
#   scripts/gh/labels.sh
#       Syncs the current repository (`gh repo view`).
#   scripts/gh/labels.sh --dry-run
#       Prints what a sync would do and changes nothing.
#   scripts/gh/labels.sh --self-test
#       Validates .github/labels.yml, then drives this program against a stub
#       gh on PATH: a missing label is created, a drifted one updated, a
#       matching one left alone, a retired one deleted, a dry run writes
#       nothing, and a refused gh call fails the run.
#   Any other argument, --help included, prints this usage and exits 2
#   before any gh call.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABELS_FILE="${LABELS_FILE:-$here/../../.github/labels.yml}"

die() {
  echo "gh-labels: $*" >&2
  exit 1
}

usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

# The labels of the file as "name<TAB>color<TAB>description" lines.
parse_labels() {
  awk '
    function unquote(s) {
      sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s)
      if (s ~ /^".*"$/) { s = substr(s, 2, length(s) - 2) }
      return s
    }
    function flush() {
      if (name != "") { print name "\t" color "\t" desc }
      name = ""; color = ""; desc = ""
    }
    /^labels:/  { section = "labels"; next }
    /^retired:/ { flush(); section = "retired"; next }
    section == "labels" && /^  - name:/ { flush(); line = $0; sub(/^  - name:/, "", line); name = unquote(line); next }
    section == "labels" && /^    color:/ { line = $0; sub(/^    color:/, "", line); color = unquote(line); next }
    section == "labels" && /^    description:/ { line = $0; sub(/^    description:/, "", line); desc = unquote(line); next }
    END { flush() }
  ' "$LABELS_FILE"
}

# The retired names of the file, one per line.
parse_retired() {
  awk '
    /^[a-z]+:/ { section = $1; next }
    section == "retired:" && /^  - / { line = $0; sub(/^  - /, "", line); gsub(/"/, "", line); print line }
  ' "$LABELS_FILE"
}

# validate: the file is well formed, or the run stops before any gh call.
validate() {
  local rows bad=0 name color desc
  [[ -f "$LABELS_FILE" ]] || die "no label file at $LABELS_FILE"
  rows="$(parse_labels)"
  [[ -n "$rows" ]] || die "$LABELS_FILE lists no label"
  while IFS=$'\t' read -r name color desc; do
    if ! [[ "$color" =~ ^[0-9a-fA-F]{6}$ ]]; then
      echo "gh-labels: '$name' has the colour '$color', not six hex digits" >&2
      bad=1
    fi
    if [[ -z "$desc" || ${#desc} -gt 100 ]]; then
      echo "gh-labels: '$name' needs a description of 1 to 100 characters (has ${#desc})" >&2
      bad=1
    fi
  done <<<"$rows"
  local dupes
  dupes="$(cut -f1 <<<"$rows" | tr '[:upper:]' '[:lower:]' | sort | uniq -d)"
  if [[ -n "$dupes" ]]; then
    echo "gh-labels: listed twice: $dupes" >&2
    bad=1
  fi
  [[ "$bad" -eq 0 ]] || die "$LABELS_FILE is not valid"
}

sync() {
  local dry=$1 existing rows name color desc current
  command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed"
  command -v jq >/dev/null 2>&1 || die "jq is not installed"
  gh repo view --json nameWithOwner --jq .nameWithOwner >/dev/null 2>&1 ||
    die "could not resolve the current repository (run inside a gh-authenticated clone)"

  # Read once, so no gh call writes into a pipe grep has stopped reading.
  existing="$(gh label list --limit 500 --json name,color,description \
    --jq '.[] | "\(.name)\t\(.color | ascii_downcase)\t\(.description)"')"
  rows="$(parse_labels)"

  while IFS=$'\t' read -r name color desc; do
    color="$(tr '[:upper:]' '[:lower:]' <<<"$color")"
    current="$(awk -F'\t' -v n="$name" '$1 == n { print; exit }' <<<"$existing")"
    if [[ -z "$current" ]]; then
      echo "create: $name"
      [[ "$dry" -eq 1 ]] || gh label create "$name" --color "$color" --description "$desc" </dev/null >/dev/null
    elif [[ "$current" != "$name"$'\t'"$color"$'\t'"$desc" ]]; then
      echo "update: $name"
      [[ "$dry" -eq 1 ]] || gh label edit "$name" --color "$color" --description "$desc" </dev/null >/dev/null
    else
      echo "unchanged: $name"
    fi
  done <<<"$rows"

  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if cut -f1 <<<"$existing" | grep -qxF -- "$name"; then
      echo "retire: $name"
      [[ "$dry" -eq 1 ]] || gh label delete "$name" --yes </dev/null >/dev/null
    fi
  done < <(parse_retired)
  if [[ "$dry" -eq 1 ]]; then
    echo "dry run: nothing changed."
  else
    echo "done."
  fi
}

self_test() {
  command -v jq >/dev/null 2>&1 || die "jq is not installed"
  validate
  local rows required
  rows="$(parse_labels)"
  # The names CI and Dependabot depend on.
  for required in no-changelog no-issue dependencies; do
    cut -f1 <<<"$rows" | grep -qxF "$required" ||
      die "self-test failed: $LABELS_FILE lacks the '$required' label CI reads"
  done

  local work stub calls
  work="$(mktemp -d)"
  stub="$work/bin"
  calls="$work/calls"
  mkdir -p "$stub"
  cat > "$stub/gh" <<'STUB'
#!/usr/bin/env bash
# The gh a self-test run of scripts/gh/labels.sh speaks to: it logs every
# call and answers `label list` with the labels the test says exist.
set -euo pipefail
printf '%s\n' "$*" >> "$GH_STUB_CALLS"
filter=""
previous=""
for argument in "$@"; do
  [[ "$previous" == "--jq" ]] && filter="$argument"
  previous="$argument"
done
case "${1:-} ${2:-}" in
  "repo view") echo "Example-Org/Example" ;;
  "label list") printf '%s' "$GH_STUB_LABELS" | jq -r "$filter" ;;
  "label create" | "label edit")
    [[ "${GH_STUB_WRITE:-ok}" == "ok" ]] || { echo "stub: refused" >&2; exit 1; }
    ;;
  "label delete") ;;
  *) echo "stub: an unexpected call: $*" >&2; exit 90 ;;
esac
STUB
  chmod 0755 "$stub/gh"

  cat > "$work/labels.yml" <<'YAML'
labels:
  - name: ci
    color: "ededed"
    description: "CI, build, and tooling."
  - name: portal:student
    color: "1D76DB"
    description: "Student portal."
  - name: no-changelog
    color: "bfdadc"
    description: "PR escape hatch."
retired:
  - bug
  - enhancement
YAML

  local rc out labels write
  run() {
    local name=$1 code=$2
    shift 2
    rc=0
    : > "$calls"
    PATH="$stub:$PATH" GH_STUB_CALLS="$calls" GH_STUB_LABELS="$labels" \
      GH_STUB_WRITE="$write" LABELS_FILE="$work/labels.yml" \
      bash "$0" "$@" > "$work/out" 2> "$work/err" || rc=$?
    out="$work/out"
    if [[ "$rc" -ne "$code" ]]; then
      echo "gh-labels: self-test failed: $name exited $rc, wanted $code." >&2
      cat "$work/out" "$work/err" "$calls" >&2
      exit 1
    fi
  }
  said() {
    grep -qF -- "$3" "$2" || {
      echo "gh-labels: self-test failed: $1 did not say '$3'." >&2
      cat "$work/out" "$work/err" "$calls" >&2
      exit 1
    }
  }
  never() {
    if grep -qF -- "$3" "$2"; then
      echo "gh-labels: self-test failed: $1 said '$3'." >&2
      cat "$work/out" "$work/err" "$calls" >&2
      exit 1
    fi
  }

  labels='[{"name":"ci","color":"EDEDED","description":"CI, build, and tooling."},{"name":"portal:student","color":"000000","description":"Old."},{"name":"bug","color":"d73a4a","description":"x"},{"name":"keep-me","color":"000000","description":"Not ours."}]'
  write=ok
  local sync_case="a sync over a drifted repository"
  run "$sync_case" 0
  said "$sync_case" "$out" "unchanged: ci"
  said "$sync_case" "$out" "update: portal:student"
  said "$sync_case" "$out" "create: no-changelog"
  said "$sync_case" "$out" "retire: bug"
  said "$sync_case" "$calls" "label edit portal:student --color 1d76db --description Student portal."
  said "$sync_case" "$calls" "label create no-changelog --color bfdadc"
  said "$sync_case" "$calls" "label delete bug --yes"
  never "$sync_case" "$calls" "label edit ci"
  never "$sync_case" "$calls" "label delete enhancement"
  never "$sync_case" "$calls" "keep-me"

  local dry_case="a dry run"
  run "$dry_case" 0 --dry-run
  said "$dry_case" "$out" "update: portal:student"
  said "$dry_case" "$out" "dry run: nothing changed."
  never "$dry_case" "$calls" "label create"
  never "$dry_case" "$calls" "label edit"
  never "$dry_case" "$calls" "label delete"

  write=fail
  run "a refused gh write" 1
  never "a refused gh write" "$out" "done."

  write=ok
  printf 'labels:\n  - name: x\n    color: "zzz"\n    description: "d"\n' > "$work/labels.yml"
  run "a malformed colour" 1
  said "a malformed colour" "$work/err" "not six hex digits"
  [[ ! -s "$calls" ]] || die "self-test failed: a malformed file reached gh"

  for argument in --help -h --bogus help; do
    run "the argument $argument" 2 "$argument"
    said "the argument $argument" "$work/err" "Usage:"
    [[ ! -s "$calls" ]] || die "self-test failed: the argument $argument called gh"
  done

  rm -r "$work"
  echo "gh-labels: self-test OK."
}

case "$#:${1:-}" in
  0:) validate; sync 0 ;;
  1:--dry-run) validate; sync 1 ;;
  1:--self-test) self_test ;;
  *) usage ;;
esac
