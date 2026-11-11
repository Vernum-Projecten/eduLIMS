#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Claude Code PostToolUse hook (matcher: Edit|Write).
#
# When the edited file is a package.json, or .node-version: every entry of
# dependencies, devDependencies and optionalDependencies is an exact version
# (1.2.3, 1.2.3-rc.1, or a workspace:/catalog:/npm: alias), never a range
# (^, ~, >, <, *, x, latest, a tag); `packageManager` is pnpm@<exact>; and
# the pins that repeat each other agree: devEngines.runtime.version equals
# .node-version, devEngines.packageManager.version equals the packageManager
# version. Exit 2 feeds the findings back as a correction.

set -euo pipefail

payload="$(cat)" || true
command -v jq >/dev/null 2>&1 || exit 0

file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null)" || true
[[ -n "${file:-}" ]] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
case "$(basename -- "$file")" in
package.json) pkg="$file" ;;
.node-version) pkg="$root/package.json" ;;
*) exit 0 ;;
esac
[[ -f "$pkg" ]] || exit 0
case "$pkg" in */node_modules/*) exit 0 ;; *) ;; esac

if ! jq -e . "$pkg" >/dev/null 2>&1; then
  echo "versions_guard: $pkg is not valid JSON." >&2
  exit 2
fi

exact='^(npm:[^@]+@)?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
findings="$(jq -r --arg re "$exact" '
  [ (.dependencies // {}), (.devDependencies // {}), (.optionalDependencies // {}) ]
  | add // {}
  | to_entries[]
  | select((.value | test("^(workspace:|catalog:|link:|file:)")) | not)
  | select((.value | test($re)) | not)
  | "  \(.key): \"\(.value)\" is not an exact version"' "$pkg")"

pm="$(jq -r '.packageManager // empty' "$pkg")"
if [[ -n "$pm" && ! "$pm" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  findings+=$'\n'"  packageManager: \"$pm\" must be pnpm@<exact version>"
fi

pm_engine="$(jq -r '.devEngines.packageManager.version // empty' "$pkg")"
if [[ -n "$pm" && -n "$pm_engine" && "${pm#pnpm@}" != "$pm_engine" ]]; then
  findings+=$'\n'"  devEngines.packageManager.version \"$pm_engine\" differs from packageManager \"$pm\""
fi

node_engine="$(jq -r '.devEngines.runtime.version // empty' "$pkg")"
node_file="$(dirname -- "$pkg")/.node-version"
if [[ -n "$node_engine" && -f "$node_file" ]]; then
  node_pin="$(tr -d '[:space:]v' <"$node_file")"
  if [[ "$node_pin" != "$node_engine" ]]; then
    findings+=$'\n'"  .node-version \"$node_pin\" differs from devEngines.runtime.version \"$node_engine\""
  fi
fi

findings="$(printf '%s' "$findings" | sed '/^$/d')"
if [[ -n "$findings" ]]; then
  echo "versions_guard: $pkg breaks the exact-pin rule (.claude/rules/typescript-style.md, Dependencies):" >&2
  printf '%s\n' "$findings" >&2
  echo "Pin the exact version you checked on the npm registry (pnpm add <pkg>@<version>; .npmrc has save-exact=true)." >&2
  exit 2
fi

exit 0
