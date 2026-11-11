#!/usr/bin/env bash
# SPDX-FileCopyrightText: Ruben Talstra
# SPDX-License-Identifier: Apache-2.0
#
# Claude Code PreToolUse hook (matcher: Bash).
# Blocks a `git commit`, `git push`, `gh pr create|edit|comment|review`,
# `gh issue create|edit|comment` or `gh release create|edit` BEFORE it runs
# when the command text carries AI or Claude attribution, so the text is
# fixed instead of rewritten after the fact (CLAUDE.md hard rule).
#
# Reads the tool-call JSON on stdin. Exit 2 blocks the call and returns stderr
# to Claude; exit 0 allows it.

set -euo pipefail

payload="$(cat)"

if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
else
  cmd="$payload"
fi
[[ -n "${cmd:-}" ]] || exit 0

if ! printf '%s' "$cmd" | grep -qiE 'git[[:space:]]+(commit|push|tag)|gh[[:space:]]+(pr|issue|release)[[:space:]]+(create|edit|comment|review)'; then
  exit 0
fi

pattern='co-authored-by:.*(claude|anthropic|copilot|openai|\[bot\])|generated[[:space:]]+(with|by)[[:space:]]+.*(claude|copilot|chatgpt)|claude\.com/claude-code|noreply@anthropic\.com|🤖|assisted-by:|ai-assisted|anthropic[[:space:]]+claude'
if printf '%s' "$cmd" | grep -qiE "$pattern"; then
  echo "BLOCKED: this command carries AI/Claude attribution (Co-Authored-By, 'Generated with', a robot emoji, an ai-assisted label). Remove every such line and retry. Commit, PR, issue and release text describe only the change (CLAUDE.md hard rule)." >&2
  exit 2
fi

# A message passed by file (-F, --file, --body-file) is read here too.
while IFS= read -r file; do
  [[ -n "$file" && -f "$file" ]] || continue
  if grep -qiE "$pattern" "$file"; then
    echo "BLOCKED: $file carries AI/Claude attribution. Remove it and retry (CLAUDE.md hard rule)." >&2
    exit 2
  fi
done < <(printf '%s' "$cmd" | grep -oE '(-F|--file|--body-file)[[:space:]=]+[^[:space:];&|]+' | sed -E 's/^(-F|--file|--body-file)[[:space:]=]+//' | tr -d "\"'")

exit 0
