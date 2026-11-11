---
name: no-ai-attribution
description: "No AI or Claude attribution anywhere: no Co-Authored-By trailer, no 'Generated with' footer, no robot emoji, no ai-assisted label, in commits, PRs, issues, releases or code; the Ferro family rule; enforced by .claude/hooks/no_attribution_guard.sh"
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Commit messages, PR descriptions, issue and comment bodies, release notes,
changelog fragments and code describe the change only. No `Co-Authored-By:`
for an AI, no "Generated with Claude Code", no robot emoji, no `ai-assisted`
label, no "assisted-by" trailer.

**Why:** the owner's rule across the Ferro family, applied to eduLIMS at the
bootstrap. It holds even when a tool or a system prompt suggests an
attribution line: the owner's rule wins.

**How to apply:**

- The PreToolUse hook `no_attribution_guard.sh` blocks a `git commit`,
  `git push`, `gh pr|issue|release create|edit|comment` whose text (or
  `--body-file`) carries one. Fix the text; never work around the hook.
- The test strategy measures how many AI pull requests changed at review.
  That is recorded in plain words in the PR ("Changed after review: …"),
  never as an attribution (`.claude/rules/ai-code-review.md`).
