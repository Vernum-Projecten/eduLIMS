#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Claude Code PreToolUse hook (matcher: Bash).
# Blocks a `git commit` BEFORE it runs while a staged file in the checkout the
# command runs in holds a merge-conflict marker. It reads the staged blob
# (`git show :<path>`), so what is checked is what would be committed.
#
# Reads the tool-call JSON on stdin. Exit 2 blocks; exit 0 allows.

set -euo pipefail

payload="$(cat)"

if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
  cwd="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true)"
else
  cmd="$payload"
  cwd=""
fi
[[ -n "${cmd:-}" ]] || exit 0
printf '%s' "$cmd" | grep -qE 'git[[:space:]]+commit' || exit 0

# The checkout the command runs in: a leading `cd <dir>`, a `git -C <dir>`,
# else the session's working directory.
dir="$(printf '%s' "$cmd" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^&;[:space:]]+).*/\1/p' | head -n 1)"
if [[ -z "$dir" ]]; then
  dir="$(printf '%s' "$cmd" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+([^[:space:]]+)[[:space:]]+commit.*/\1/p' | head -n 1)"
fi
dir="${dir:-${cwd:-${CLAUDE_PROJECT_DIR:-.}}}"
dir="${dir//[\"\']/}"
git -C "$dir" rev-parse --show-toplevel >/dev/null 2>&1 || exit 0

found=0
while IFS= read -r -d '' path; do
  if git -C "$dir" show ":$path" 2>/dev/null | grep -nE '^(<{7}( |$)|={7}$|>{7}( |$)|\|{7}( |$))' >/dev/null; then
    echo "conflict marker in staged file: $path" >&2
    found=1
  fi
done < <(git -C "$dir" diff --cached --name-only --diff-filter=ACMR -z)

if [[ "$found" -eq 1 ]]; then
  echo "BLOCKED: a staged file holds an unresolved merge conflict; resolve it before you commit." >&2
  exit 2
fi
exit 0
