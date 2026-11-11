#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# The linked-issue guard: a pull request names the issue it closes, so every
# change on main traces back to a tracked requirement (S1 to B4) or defect.
#
# The description holds a closing keyword GitHub links on: close, closes,
# closed, fix, fixes, fixed, resolve, resolves or resolved (any case), then a
# space or a colon, then `#<n>`, `<owner>/<repo>#<n>` or the issue URL.
#
# Usage:
#   scripts/checks/linked-issue.sh < body.md
#   scripts/checks/linked-issue.sh --self-test
#
# The `no-issue` pull-request label is the CI escape for a change that no
# issue tracks; this script does not read labels.
#
# Exit 0 when the description links an issue, 1 when it does not, 2 on a
# usage error.
# Keywords: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
set -euo pipefail

readonly KEYWORDS='(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)'
readonly TARGET='(#[0-9]+|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[0-9]+|https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/[0-9]+)'

usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

check() {
  local body
  body="$(cat)"
  # An HTML comment is the template's hint text, so a `Closes #NNN` left in
  # one does not count.
  body="$(printf '%s' "$body" | perl -0pe 's/<!--.*?-->//gs')"
  if printf '%s\n' "$body" | grep -qiE "(^|[^A-Za-z])${KEYWORDS}:? +${TARGET}"; then
    echo "linked-issue: the description links the issue it closes."
    return 0
  fi
  echo "::error::the pull-request description links no issue: add 'Closes #<n>', or apply the 'no-issue' label when no issue tracks the change." >&2
  return 1
}

self_test() {
  local rc
  expect() {
    local want=$1 body=$2
    rc=0
    printf '%s' "$body" | check > /dev/null 2>&1 || rc=$?
    if [[ "$rc" -ne "$want" ]]; then
      echo "linked-issue: self-test failed: '$body' exited $rc, wanted $want." >&2
      exit 1
    fi
  }
  expect 0 $'## What\n\nCloses #12'
  expect 0 "fixes #3 and more"
  expect 0 "Resolves: #7"
  expect 0 "closes Vernum-Projecten/eduLIMS#42"
  expect 0 "Closes https://github.com/Vernum-Projecten/eduLIMS/issues/42"
  expect 1 "Relates to #12"
  expect 1 "Closes #NNN"
  expect 1 $'<!-- Closes #12 -->\nNo link here.'
  expect 1 "encloses #12"
  expect 1 ""
  echo "linked-issue: self-test OK."
}

case "$#:${1:-}" in
  1:--self-test) self_test ;;
  0:) check ;;
  *) usage ;;
esac
