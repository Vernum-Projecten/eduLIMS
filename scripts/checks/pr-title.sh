#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
# The pull-request title guard: the title is a Conventional Commits 1.0.0
# header, because the merge queue squashes a pull request into one commit and
# that commit takes the title as its subject.
#
#   <type>[(<scope>)][!]: <description>
#
# The types are the Conventional Commits set the commitlint convention uses:
# feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert. The
# scope is lower case (letters, digits, and `-`, `_`, `.`, `/`, `:`), the
# description starts with a non-space and ends without a period, and the whole
# title stays within 100 characters.
#
# Usage:
#   scripts/checks/pr-title.sh <title>
#   scripts/checks/pr-title.sh --self-test
#
# Exit 0 when the title holds, 1 when it does not, 2 on a usage error.
# Spec: https://www.conventionalcommits.org/en/v1.0.0/
set -euo pipefail

readonly TYPES='feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert'
readonly MAX=100

usage() {
  sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

check() {
  local title="$1"
  if (( ${#title} > MAX )); then
    echo "::error::the pull-request title is ${#title} characters long; keep it within ${MAX}." >&2
    return 1
  fi
  if ! [[ "$title" =~ ^($TYPES)(\([a-z0-9._/:-]+\))?!?:\ [^[:space:]] ]]; then
    echo "::error::the pull-request title is not a Conventional Commits header: write '<type>(<scope>): <description>' with a type from ${TYPES//|/, }." >&2
    return 1
  fi
  if [[ "$title" == *. ]]; then
    echo "::error::the pull-request title ends with a period; drop it." >&2
    return 1
  fi
  echo "pr-title: '$title' is a Conventional Commits header."
}

self_test() {
  local rc
  expect() {
    local want=$1 title=$2
    rc=0
    check "$title" > /dev/null 2>&1 || rc=$?
    if [[ "$rc" -ne "$want" ]]; then
      echo "pr-title: self-test failed: '$title' exited $rc, wanted $want." >&2
      exit 1
    fi
  }
  expect 0 "feat: add the sample register"
  expect 0 "fix(upload): refuse an unknown well position"
  expect 0 "feat(portal:student)!: drop the legacy login"
  expect 0 "build(deps): bump vite from 8.3.6 to 8.3.7"
  expect 0 "ci(deps): bump the actions-minor-patch group with 3 updates"
  expect 0 "revert: feat: add the sample register"
  expect 1 "Add the sample register"
  expect 1 "feature: add the sample register"
  expect 1 "feat:add the sample register"
  expect 1 "feat(Upload): refuse an unknown well position"
  expect 1 "feat: add the sample register."
  expect 1 "feat:  "
  expect 1 "feat: $(printf 'x%.0s' $(seq 1 100))"
  echo "pr-title: self-test OK."
}

case "$#:${1:-}" in
  1:--self-test) self_test ;;
  1:-*) usage ;;
  1:*) check "$1" ;;
  *) usage ;;
esac
