#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Claude Code PostToolUse hook (matcher: Edit|Write).
#
# For an edited TS, TSX, JS, JSON or CSS file: run `biome check --write` on
# that one file (format, organise imports, safe lint fixes), then feed any
# diagnostic Biome could not fix back to Claude (exit 2) so it corrects the
# file. Files biome.json excludes (the route tree, the lockfile, pnpm-linked
# skills) are skipped by Biome itself.
#
# For an edited .sh file: run shellcheck when it is installed.
#
# The typecheck (`pnpm typecheck`) is a per-change gate, not a per-edit one:
# tsc checks the whole program, too slow to run on every save.

set -euo pipefail

payload="$(cat)" || true

if command -v jq >/dev/null 2>&1; then
  file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)" || true
else
  file="$(printf '%s' "$payload" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
fi
[[ -n "${file:-}" && -f "$file" ]] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

case "$file" in
*.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs | *.json | *.jsonc | *.css)
  biome="$root/node_modules/.bin/biome"
  if [[ ! -x "$biome" ]]; then
    echo "biome_check: $biome not found; run 'pnpm install'." >&2
    exit 0
  fi
  if ! out="$(cd "$root" && "$biome" check --write --no-errors-on-unmatched --files-ignore-unknown=true --colors=off --max-diagnostics=30 "$file" 2>&1)"; then
    printf '%s\n' "$out" | head -n 120 >&2
    echo "biome_check: fix the diagnostics above in $file (.claude/rules/typescript-style.md); a suppression needs a written reason." >&2
    exit 2
  fi
  ;;
*.sh)
  if command -v shellcheck >/dev/null 2>&1; then
    if ! out="$(shellcheck --severity=style "$file" 2>&1)"; then
      printf '%s\n' "$out" >&2
      exit 2
    fi
  fi
  ;;
*) ;;
esac

exit 0
