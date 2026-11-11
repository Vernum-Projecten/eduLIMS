#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Changelog fragments, ported from the Ferro repositories. Every change with a
# user-visible effect adds one file under changelog.d/, so no two pull
# requests edit the same lines of CHANGELOG.md, and the release cut assembles
# the fragments into CHANGELOG.md, which follows Keep a Changelog 1.1.0
# (https://keepachangelog.com/en/1.1.0/).
#
# A fragment is changelog.d/[<issue>-]<kebab-slug>.<section>.md, where
# <section> is added, changed, deprecated, removed, fixed or security, and its
# content is one or more Markdown list items exactly as they read in
# CHANGELOG.md: a line that opens with "- ", continued by lines indented by at
# least two spaces. changelog.d/README.md is the format note and is never read
# as a fragment.
#
#   changelog.sh --check
#       Validates every fragment's name and content. Exit 0 when every one
#       holds, 1 otherwise, naming each defect.
#   changelog.sh --assemble <version> <date>
#       Writes a new "## [<version>] - <date>" section under a fresh, empty
#       [Unreleased], holding the entries still under [Unreleased] followed by
#       the fragments, section by section in the Keep a Changelog order; moves
#       the [Unreleased] link reference on and adds the version's; then
#       `git rm`s the fragments. Exit 1 on any defect, with nothing written.
#   changelog.sh --preview
#       Prints CHANGELOG.md with every fragment folded into [Unreleased], as the
#       next cut would write that section, and writes nothing.
#   changelog.sh --check-preview
#       Runs the structure check over the preview, so a release section's
#       rules hold on every pull request and not first at the cut.
#   changelog.sh --structure [<file>]
#       The structure check alone: every "### " heading inside a release
#       section is a Keep a Changelog type, and none repeats in one section.
#   changelog.sh --notes <version>
#       Prints the body of the "## [<version>]" section, the release notes.
#   changelog.sh --self-test
#       Proves every mode over a stub repository.
#
# The output is deterministic: fragments are read by section in the order
# above, then by file name in the C locale. Exit 2 on a usage error.
set -euo pipefail
export LC_ALL=C

# The Keep a Changelog 1.1.0 sections, in the order a release lists them.
readonly SECTIONS=(added changed deprecated removed fixed security)
readonly FRAGMENT_DIR=changelog.d
readonly NAME_RE='^([0-9]+-)?[a-z0-9]+(-[a-z0-9]+)*\.(added|changed|deprecated|removed|fixed|security)\.md$'

die() {
  echo "changelog: $*" >&2
  exit 1
}

usage() {
  echo "usage: changelog.sh --check | --assemble <version> <date> | --preview | --check-preview | --structure [<file>] | --notes <version> | --self-test" >&2
  exit 2
}

# title SECTION: the heading a section carries in CHANGELOG.md.
title() {
  local section="$1"
  printf '%s%s' "$(tr '[:lower:]' '[:upper:]' <<<"${section:0:1}")" "${section:1}"
}

# content_defect FILE: prints why FILE is no list item, or nothing when it is.
content_defect() {
  local file="$1"
  awk '
    { lines[NR] = $0 }
    END {
      last = NR
      while (last > 0 && lines[last] ~ /^[[:space:]]*$/) last--
      if (last == 0) { print "it is empty"; exit }
      if (lines[1] !~ /^- [^[:space:]]/) { print "line 1 does not open a list item with \"- \""; exit }
      for (i = 2; i <= last; i++) {
        if (lines[i] ~ /^- [^[:space:]]/ || lines[i] ~ /^  +[^[:space:]]/) continue
        if (lines[i] ~ /^[[:space:]]*$/) { print "line " i " is blank inside the entry"; exit }
        print "line " i " neither opens a list item nor continues one indented by two spaces"
        exit
      }
    }
  ' "$file"
}

# check: every fragment's name and content, every defect named.
check() {
  local fail=0 count=0 path name defect
  [[ -d "$FRAGMENT_DIR" ]] || die "$FRAGMENT_DIR/ is missing"
  for path in "$FRAGMENT_DIR"/* "$FRAGMENT_DIR"/.[!.]*; do
    [[ -e "$path" ]] || continue
    name="${path#"$FRAGMENT_DIR"/}"
    [[ "$name" != README.md ]] || continue
    if [[ ! -f "$path" ]]; then
      echo "changelog: $path is not a file; a fragment is one file directly under $FRAGMENT_DIR/." >&2
      fail=1
      continue
    fi
    if [[ ! "$name" =~ $NAME_RE ]]; then
      echo "changelog: $path is not named [<issue>-]<kebab-slug>.<section>.md with <section> one of ${SECTIONS[*]}." >&2
      fail=1
      continue
    fi
    defect="$(content_defect "$path")"
    if [[ -n "$defect" ]]; then
      echo "changelog: $path is not a Markdown list item: $defect." >&2
      fail=1
      continue
    fi
    count=$((count + 1))
  done
  [[ "$fail" -eq 0 ]] || exit 1
  echo "changelog: $count fragment(s) under $FRAGMENT_DIR/, every one well formed."
}

# structure FILE: the Keep a Changelog structure of every release section.
structure() {
  local file="${1:-CHANGELOG.md}"
  [[ -f "$file" ]] || die "$file is missing"
  awk -v path="$file" '
    /^## \[/ {
      section = $0
      sub(/^## \[/, "", section)
      sub(/\].*$/, "", section)
      delete seen
      next
    }
    /^### / && section != "" {
      heading = $0
      sub(/^### /, "", heading)
      sub(/[[:space:]]+$/, "", heading)
      if (heading !~ /^(Added|Changed|Deprecated|Removed|Fixed|Security)$/) {
        errors[++n] = path ":" FNR ": \"### " heading "\" in [" section "] is not a Keep a Changelog type"
      }
      if (heading in seen) {
        errors[++n] = path ":" FNR ": a second \"### " heading "\" in [" section "]; merge the entries into the first"
      }
      seen[heading] = 1
    }
    END {
      if (n > 0) {
        print "changelog: the structure check failed:" > "/dev/stderr"
        for (i = 1; i <= n; i++) print "  " errors[i] > "/dev/stderr"
        exit 1
      }
      print "changelog: the structure of " path " holds."
    }
  ' "$file"
}

# notes VERSION: the body of the version's section.
notes() {
  local version="$1"
  [[ -f CHANGELOG.md ]] || die "CHANGELOG.md is missing"
  awk -v heading="## [$version] - " '
    index($0, heading) == 1 { found = 1; next }
    found && (/^## \[/ || /^\[[^]]+\]: /) { exit }
    found { print }
    END { if (!found) exit 1 }
  ' CHANGELOG.md | awk 'NF { started = 1 } started' || die "CHANGELOG.md has no '## [$version] - <date>' section"
}

# assemble VERSION DATE [preview]: the cut, written to CHANGELOG.md in one
# move. With "preview" it prints the file with the fragments folded into
# [Unreleased] instead, and touches nothing.
assemble() {
  local version="$1" date="$2" mode="${3:-cut}" work start end total section file prev base out
  if [[ "$mode" == cut ]]; then
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "'$version' is not a version such as 0.1.0 or 0.1.0-rc.1"
    [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "'$date' is not a date written YYYY-MM-DD"
  fi
  [[ -f CHANGELOG.md ]] || die "CHANGELOG.md is missing"
  check > /dev/null

  if [[ "$mode" == cut ]] && awk -v heading="## [$version]" 'index($0, heading) == 1 { found = 1 } END { exit !found }' CHANGELOG.md; then
    die "CHANGELOG.md already has a [$version] section"
  fi
  start="$(grep -n -m1 -E '^## \[Unreleased\][[:space:]]*$' CHANGELOG.md | cut -d: -f1 || true)"
  [[ -n "$start" ]] || die "CHANGELOG.md has no '## [Unreleased]' heading"
  total="$(wc -l < CHANGELOG.md | tr -d ' ')"
  # The [Unreleased] body ends at the next version heading or at the link
  # reference block, whichever comes first.
  end="$(awk -v s="$start" 'NR > s && (/^## \[/ || /^\[[^]]+\]: /) { print NR - 1; exit }' CHANGELOG.md)"
  [[ -n "$end" ]] || end="$total"

  # The [Unreleased] link either compares against the previous tag or, before
  # the first release, points at the commit history.
  prev="$(sed -nE 's|^\[Unreleased\]: (.*)/compare/([^/]+)\.\.\.HEAD$|\2|p' CHANGELOG.md)"
  base="$(sed -nE 's|^\[Unreleased\]: (.*)/compare/([^/]+)\.\.\.HEAD$|\1|p' CHANGELOG.md)"
  if [[ -z "$base" ]]; then
    base="$(sed -nE 's|^\[Unreleased\]: (.*)/commits/[^/]+$|\1|p' CHANGELOG.md)"
  fi
  [[ "$mode" == preview || -n "$base" ]] || die "CHANGELOG.md has no '[Unreleased]: <repository>/compare/<tag>...HEAD' or '<repository>/commits/<branch>' link reference"

  work="$(mktemp -d)"
  # Global, so the EXIT trap still sees it after the function returns.
  assemble_work="$work"
  trap 'rm -r -- "$assemble_work"' EXIT

  # The entries still under [Unreleased], one file per section. Anything
  # outside a known section heading is refused, never dropped.
  sed -n "$((start + 1)),${end}p" CHANGELOG.md | awk -v dir="$work" '
    /^### / {
      heading = substr($0, 5)
      sub(/[[:space:]]+$/, "", heading)
      section = tolower(heading)
      if (section !~ /^(added|changed|deprecated|removed|fixed|security)$/) {
        print "changelog: [Unreleased] has a section \"" heading "\", which Keep a Changelog 1.1.0 does not define." > "/dev/stderr"
        exit 1
      }
      next
    }
    section == "" && /[^[:space:]]/ {
      print "changelog: [Unreleased] holds text outside a section heading: " $0 > "/dev/stderr"
      exit 1
    }
    section != "" { print > (dir "/old." section) }
  ' || exit 1

  # Each section of the release: the [Unreleased] entries first, in their
  # order, then the fragments by file name.
  local fragments=() entries=0
  for section in "${SECTIONS[@]}"; do
    {
      [[ ! -f "$work/old.$section" ]] || trim "$work/old.$section"
      for file in "$FRAGMENT_DIR"/*."$section".md; do
        [[ -e "$file" ]] || continue
        tracked "$file" "$mode"
        fragments+=("$file")
        trim "$file" | name_issue "$file"
      done
    } > "$work/new.$section"
    [[ ! -s "$work/new.$section" ]] || entries=$((entries + 1))
  done

  if [[ "$mode" == preview ]]; then
    sed -n "1,${start}p" CHANGELOG.md
    for section in "${SECTIONS[@]}"; do
      [[ -s "$work/new.$section" ]] || continue
      printf '\n### %s\n\n' "$(title "$section")"
      cat "$work/new.$section"
    done
    printf '\n'
    [[ "$end" -ge "$total" ]] || sed -n "$((end + 1)),${total}p" CHANGELOG.md
    return 0
  fi
  [[ "$entries" -gt 0 ]] || die "[$version] would be empty: no fragment under $FRAGMENT_DIR/ and no entry under [Unreleased]"

  out="$work/CHANGELOG.md"
  {
    sed -n "1,${start}p" CHANGELOG.md
    printf '\n## [%s] - %s\n' "$version" "$date"
    for section in "${SECTIONS[@]}"; do
      [[ -s "$work/new.$section" ]] || continue
      printf '\n### %s\n\n' "$(title "$section")"
      cat "$work/new.$section"
    done
    printf '\n'
    if [[ "$end" -lt "$total" ]]; then
      sed -n "$((end + 1)),${total}p" CHANGELOG.md | awk -v ver="$version" -v prev="$prev" -v base="$base" '
        /^\[Unreleased\]: / {
          print "[Unreleased]: " base "/compare/v" ver "...HEAD"
          if (prev != "") print "[" ver "]: " base "/compare/" prev "...v" ver
          else print "[" ver "]: " base "/releases/tag/v" ver
          next
        }
        { print }
      '
    fi
  } > "$out"

  cat "$out" > CHANGELOG.md
  if [[ "${#fragments[@]}" -gt 0 ]]; then
    git rm -q -- "${fragments[@]}"
  fi
  echo "changelog: [$version] - $date assembled from ${#fragments[@]} fragment(s) and the [Unreleased] entries; review CHANGELOG.md and commit."
}

# tracked FILE MODE: refuses an untracked fragment at the cut; the preview reads
# the working tree as it stands.
tracked() {
  local file="$1" mode="$2"
  [[ "$mode" == preview ]] && return 0
  git ls-files --error-unmatch -- "$file" > /dev/null 2>&1 || die "$file is not tracked by git; commit it before the cut"
}

# check_preview: the structure check over the preview.
check_preview() {
  local dir
  dir="$(mktemp -d)"
  check_preview_dir="$dir"
  trap 'rm -r -- "$check_preview_dir"' EXIT
  (assemble "" "" preview) > "$dir/CHANGELOG.md" || return 1
  structure "$dir/CHANGELOG.md"
}

# trim FILE: FILE without its leading and trailing blank lines.
trim() {
  local file="$1"
  awk '
    { lines[NR] = $0 }
    END {
      first = 1
      while (first <= NR && lines[first] ~ /^[[:space:]]*$/) first++
      last = NR
      while (last >= first && lines[last] ~ /^[[:space:]]*$/) last--
      for (i = first; i <= last; i++) print lines[i]
    }
  ' "$file"
}

# name_issue FILE: the entries on stdin, each ending its first paragraph with
# the issue the fragment's file name starts with, `(#NNN)`, unless the entry
# already names that issue or the file name carries none. A trailing full stop
# stays last.
name_issue() {
  local issue
  issue="$(basename "$1")"
  if [[ ! "$issue" =~ ^[0-9]+- ]]; then
    cat
    return 0
  fi
  issue="${issue%%-*}"
  awk -v issue="$issue" '
    function flush(   i) {
      if (count == 0) return
      if (!named) {
        if (lines[last] ~ /\.$/) {
          lines[last] = substr(lines[last], 1, length(lines[last]) - 1) " (#" issue ")."
        } else {
          lines[last] = lines[last] " (#" issue ")"
        }
      }
      for (i = 1; i <= count; i++) print lines[i]
      count = 0
      named = 0
    }
    /^- / { flush(); paragraph = 1; last = 1 }
    {
      lines[++count] = $0
      if ($0 ~ ("#" issue "([^0-9]|$)")) named = 1
      if (count > 1) {
        if ($0 ~ /^[[:space:]]+[-*] /) paragraph = 0
        else if (paragraph) last = count
      }
    }
    END { flush() }
  '
}

self_test() {
  local script status
  # Global, so the EXIT trap still sees it after the function returns.
  work="$(mktemp -d)"
  # git writes its objects read-only, so the tree is made writable before it
  # is removed.
  trap 'chmod -R u+w "$work" && rm -r -- "$work"' EXIT
  script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  mkdir -p "$work/scripts/release" "$work/$FRAGMENT_DIR"
  cp "$script" "$work/scripts/release/changelog.sh"

  # A repository of its own, so no global hook, signing key or identity of the
  # caller's reaches it.
  stub_git() {
    git -C "$work" -c user.name=self-test -c user.email=self-test@example.org \
      -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"
  }
  flunk() {
    echo "changelog: self-test failed: $*" >&2
    cat "$work/out" >&2
    exit 1
  }
  # expect NAME WANT ARGS...: the script run in the stub exits WANT.
  expect() {
    local name="$1" want="$2"
    shift 2
    status=0
    (cd "$work" && bash scripts/release/changelog.sh "$@") > "$work/out" 2>&1 || status=$?
    [[ "$status" -eq "$want" ]] || flunk "$name exited $status, wanted $want."
  }
  fragment() {
    local name="$1"
    shift
    printf '%s\n' "$@" > "$work/$FRAGMENT_DIR/$name"
  }
  unfragment() {
    rm -- "$work/$FRAGMENT_DIR/$1"
  }

  stub_git init -q -b main
  printf 'The fragment format.\n' > "$work/$FRAGMENT_DIR/README.md"

  # --check: the names and contents it accepts, and each it refuses.
  expect "a directory holding only the README" 0 --check
  fragment 3-a-change.added.md '- An entry that runs' '  over two lines.' '  - and nests a list item.' \
    '- A second entry of fragment 3, unpunctuated'
  fragment no-issue.changed.md '- An entry with no issue.'
  expect "well-formed fragments beside the README" 0 --check
  local bad
  for bad in 3-Upper.added.md 3-a.unknown.md 3-a.added.txt 3-a_b.fixed.md 3-.fixed.md -a.fixed.md; do
    fragment "$bad" '- An entry.'
    expect "the misnamed fragment $bad" 1 --check
    grep -qF -- "$bad is not named" "$work/out" || flunk "the misnamed fragment $bad failed without naming it."
    unfragment "$bad"
  done
  fragment 4-heading.fixed.md '### Fixed' '' '- An entry.'
  expect "a fragment holding a heading" 1 --check
  unfragment 4-heading.fixed.md
  fragment 4-prose.fixed.md 'A sentence, no list item.'
  expect "a fragment of prose" 1 --check
  unfragment 4-prose.fixed.md
  fragment 4-blank.fixed.md '- One entry.' '' '- Another entry.'
  expect "a fragment with a blank line inside" 1 --check
  grep -q 'line 2 is blank' "$work/out" || flunk "the blank line was not named."
  unfragment 4-blank.fixed.md
  fragment 4-flush.fixed.md '- One entry' 'continued flush left.'
  expect "a fragment continued without indentation" 1 --check
  unfragment 4-flush.fixed.md
  printf '' > "$work/$FRAGMENT_DIR/4-empty.fixed.md"
  expect "an empty fragment" 1 --check
  unfragment 4-empty.fixed.md
  mkdir "$work/$FRAGMENT_DIR/5-dir.added.md"
  expect "a directory named as a fragment" 1 --check
  rmdir "$work/$FRAGMENT_DIR/5-dir.added.md"

  # --assemble before the first release: the [Unreleased] link points at the
  # commit history, and the first version links to its tag.
  cat > "$work/CHANGELOG.md" <<'EOF'
# Changelog

## [Unreleased]

### Fixed

- A fix written into CHANGELOG.md.

[Unreleased]: https://example.org/r/commits/main
EOF
  fragment 5-x.security.md '- Fragment 5-x.'
  stub_git add -A
  stub_git commit -q -m "the stub"
  expect "a version that is no version" 1 --assemble 0.1 2026-10-10
  expect "a date that is no date" 1 --assemble 0.1.0 10-10-2026
  expect "a missing argument" 2 --assemble 0.1.0
  expect "the first cut" 0 --assemble 0.1.0 2026-10-10
  cat > "$work/want" <<'EOF'
# Changelog

## [Unreleased]

## [0.1.0] - 2026-10-10

### Added

- An entry that runs
  over two lines (#3).
  - and nests a list item.
- A second entry of fragment 3, unpunctuated (#3)

### Changed

- An entry with no issue.

### Fixed

- A fix written into CHANGELOG.md.

### Security

- Fragment 5-x (#5).

[Unreleased]: https://example.org/r/compare/v0.1.0...HEAD
[0.1.0]: https://example.org/r/releases/tag/v0.1.0
EOF
  diff -u "$work/want" "$work/CHANGELOG.md" > "$work/out" || flunk "the first assembled CHANGELOG.md differs from the expected one."
  if [[ -n "$(stub_git ls-files -- "$FRAGMENT_DIR" | grep -v '/README.md$' || true)" ]]; then
    flunk "a fragment is still tracked after the cut."
  fi
  [[ -f "$work/$FRAGMENT_DIR/README.md" ]] || flunk "the cut removed the README."
  expect "the existing version" 1 --assemble 0.1.0 2026-10-11
  stub_git commit -q -a -m "the cut"

  # --notes prints the section body, and refuses a version it does not hold.
  expect "the notes" 0 --notes 0.1.0
  head -n1 "$work/out" | grep -qx '### Added' || flunk "the notes do not open with the first section."
  grep -q 'Fragment 5-x' "$work/out" || flunk "the notes lost an entry."
  grep -q '^\[' "$work/out" && flunk "the notes hold a link reference."
  expect "notes for a version not released" 1 --notes 9.9.9

  # A second cut compares against the previous tag.
  fragment 12-b.added.md '- Fragment 12-b names its own issue (#12) already.'
  stub_git add -A
  stub_git commit -q -m "a fragment"
  expect "the second cut" 0 --assemble 0.2.0 2026-10-12
  grep -qxF '[0.2.0]: https://example.org/r/compare/v0.1.0...v0.2.0' "$work/CHANGELOG.md" || flunk "the second version does not compare against the first."
  grep -qxF -- '- Fragment 12-b names its own issue (#12) already.' "$work/CHANGELOG.md" || flunk "an entry naming its issue had it added twice."
  stub_git commit -q -a -m "the second cut"
  expect "a release with no entry" 1 --assemble 0.3.0 2026-10-13
  grep -q 'would be empty' "$work/out" || flunk "the empty release was not named."

  # A section Keep a Changelog does not define, and text outside a section,
  # are refused with CHANGELOG.md untouched.
  printf '%s\n' '# Changelog' '' '## [Unreleased]' '' '### Improved' '' '- An entry.' '' \
    '[Unreleased]: https://example.org/r/compare/v0.2.0...HEAD' > "$work/CHANGELOG.md"
  cp "$work/CHANGELOG.md" "$work/before"
  expect "a section Keep a Changelog does not define" 1 --assemble 0.3.0 2026-10-13
  cmp -s "$work/before" "$work/CHANGELOG.md" || flunk "a refused cut wrote CHANGELOG.md."
  expect "the structure check over that section" 1 --structure CHANGELOG.md
  printf '%s\n' '# Changelog' '' '## [Unreleased]' '' 'Loose prose.' '' '### Added' '' '- An entry.' '' \
    '[Unreleased]: https://example.org/r/compare/v0.2.0...HEAD' > "$work/CHANGELOG.md"
  expect "text outside a section heading" 1 --assemble 0.3.0 2026-10-13

  # --preview folds the fragments in; --check-preview refuses a duplicate
  # section the fragments and [Unreleased] would not produce, but a hand edit
  # can.
  printf '%s\n' '# Changelog' '' '## [Unreleased]' '' '### Added' '' '- By hand.' '' \
    '[Unreleased]: https://example.org/r/compare/v0.2.0...HEAD' > "$work/CHANGELOG.md"
  fragment 20-feature.added.md '- A feature.'
  expect "the preview" 0 --preview
  grep -qxF -- '- A feature (#20).' "$work/out" || flunk "the preview did not fold the fragment in."
  [[ -f "$work/$FRAGMENT_DIR/20-feature.added.md" ]] || flunk "the preview removed a fragment."
  expect "the preview's structure" 0 --check-preview
  printf '%s\n' '# Changelog' '' '## [Unreleased]' '' '## [0.2.0] - 2026-10-12' '' '### Added' '' '- One.' '' \
    '### Added' '' '- Two.' '' '[Unreleased]: https://example.org/r/compare/v0.2.0...HEAD' > "$work/CHANGELOG.md"
  expect "a duplicated section in a release" 1 --check-preview
  grep -q 'a second "### Added"' "$work/out" || flunk "the duplicate section was not named."

  echo "changelog: self-test passed."
}

case "${1:-}" in
--self-test)
  [[ $# -eq 1 ]] || usage
  self_test
  ;;
--check)
  [[ $# -eq 1 ]] || usage
  cd "$(dirname "$0")/../.."
  check
  ;;
--assemble)
  [[ $# -eq 3 ]] || usage
  cd "$(dirname "$0")/../.."
  assemble "$2" "$3"
  ;;
--preview)
  [[ $# -eq 1 ]] || usage
  cd "$(dirname "$0")/../.."
  assemble "" "" preview
  ;;
--check-preview)
  [[ $# -eq 1 ]] || usage
  cd "$(dirname "$0")/../.."
  check_preview
  ;;
--structure)
  [[ $# -le 2 ]] || usage
  cd "$(dirname "$0")/../.."
  structure "${2:-CHANGELOG.md}"
  ;;
--notes)
  [[ $# -eq 2 ]] || usage
  cd "$(dirname "$0")/../.."
  notes "$2"
  ;;
*) usage ;;
esac
