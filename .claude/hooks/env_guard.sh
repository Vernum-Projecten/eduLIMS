#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Claude Code PreToolUse hook (matcher: Bash|Read|Edit|Write).
# Keeps environment files out of the session and out of git:
#   - Read, Edit or Write of `.env` or `.env.*` (except `.env.example`)
#   - a shell command that prints or sources one (cat, less, head, source, ...)
#   - `git add` naming one, and a `git commit` while one is staged
# `.env.example` lists the variable names with empty values and stays open.
# The permission deny rules in .claude/settings.json cover the Read tool too;
# this hook also covers the shell and git paths those rules cannot see.
#
# Reads the tool-call JSON on stdin. Exit 2 blocks; exit 0 allows.

set -euo pipefail

payload="$(cat)"
command -v jq >/dev/null 2>&1 || exit 0

tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"

# True when the basename is .env or .env.<something> other than .env.example.
is_env_file() {
  local base
  base="$(basename -- "$1")"
  base="${base//[\"\']/}"
  [[ "$base" == ".env" || ( "$base" == .env.* && "$base" != ".env.example" ) ]]
}

case "$tool" in
Read | Edit | Write)
  file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
  if [[ -n "$file" ]] && is_env_file "$file"; then
    echo "BLOCKED: $file holds secrets and is never read or written from a session. Use .env.example for variable names; ask the owner for a value." >&2
    exit 2
  fi
  exit 0
  ;;
Bash) ;;
*) exit 0 ;;
esac

cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[[ -n "${cmd:-}" ]] || exit 0

# A command that names an env file: `git add` is refused outright; a read-only
# git command, a commit (its message may name the file; the staged check below
# covers the content) and a gh command pass; anything else (cat, source, cp,
# grep, an editor) is refused.
named=""
set -f
for word in ${cmd//[;&|()<>]/ }; do
  if is_env_file "$word"; then
    named="$word"
    break
  fi
done
set +f
if [[ -n "$named" ]]; then
  if printf '%s' "$cmd" | grep -qE 'git[[:space:]]+([^;&|]*[[:space:]])?add[[:space:]]'; then
    echo "BLOCKED: $named must never be committed (.gitignore keeps .env and .env.*; only .env.example is tracked)." >&2
    exit 2
  fi
  if ! printf '%s' "$cmd" | grep -qE '^[[:space:]]*(git[[:space:]]+(status|check-ignore|ls-files|log|commit)([[:space:]]|$)|gh[[:space:]])'; then
    echo "BLOCKED: this command reads or moves an environment file ($named). Secrets stay out of the session; use .env.example for names and ask the owner for values." >&2
    exit 2
  fi
fi

# git commit while an env file is staged.
if printf '%s' "$cmd" | grep -qE 'git[[:space:]]+([^;&|]*[[:space:]])?commit'; then
  dir="$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null || true)"
  dir="${dir:-${CLAUDE_PROJECT_DIR:-.}}"
  if git -C "$dir" rev-parse --show-toplevel >/dev/null 2>&1; then
    while IFS= read -r path; do
      if [[ -n "$path" ]] && is_env_file "$path"; then
        echo "BLOCKED: $path is staged. Unstage it with 'git restore --staged $path'; environment files are never committed." >&2
        exit 2
      fi
    done < <(git -C "$dir" diff --cached --name-only --diff-filter=ACMR)
  fi
fi

exit 0
