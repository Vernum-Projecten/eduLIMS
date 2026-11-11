---
name: phase-status
description: Prints the tracker's open issues (pinned first, with type, priority and native relationships), the in-flight issue's unchecked acceptance criteria, open PRs without auto-merge, and a short git status. Use when the user asks "where are we", "what's in flight", or at the start of a work session to orient.
allowed-tools: Read, Bash
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /phase-status

A fast orientation dump, the orient step of the issue workflow
(`.claude/rules/issue-workflow.md`). Read-only. The live state below is
injected at invocation; ground the answer in it, not in conversation memory.

## Live state (injected)

### Tracker and git

```!
"${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/session_start_issues.sh" 2>&1 || true
```

### Open pull requests

```!
gh pr list --state open --json number,title,headRefName,autoMergeRequest,isDraft --jq '.[] | "#\(.number) \(.title) [\(.headRefName)] auto-merge: \(if .autoMergeRequest then "armed" else "NOT ARMED" end)\(if .isDraft then " (draft)" else "" end)"' 2>&1 || echo "(gh unavailable)"
```

## Steps

1. **Tracker:** name the current focus (pinned, or the issue the branch
   implements) and its next action. For the in-flight issue, read it with
   `gh issue view <n> --json title,body,comments --jq '.title, .body,
   (.comments[] | "--- comment ---", .body)'` and report the latest status
   comment and the unchecked acceptance criteria. Flag any issue shown
   `BLOCKED-by` an open blocker (not a pickup candidate) and any shown with a
   `?` type or priority (it needs `scripts/gh/fields.sh`).
2. **Pull requests:** flag every open PR whose auto-merge is NOT ARMED;
   arming it is `gh pr merge <n> --auto`.
3. **Git:** current branch, uncommitted files, last commits. Flag finished
   work that sits uncommitted or unpushed.
4. **Open owner questions:** list any issue comment that asks the owner about
   a draft requirement and has no answer yet.
5. **Do not** modify issues or commit. For a work plan, point at
   `/next-task`.
