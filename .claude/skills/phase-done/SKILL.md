---
name: phase-done
description: Closes a tracker issue by verifying the work against the Definition of Done (acceptance criteria, tests, coverage, axe, docs), writing the close narrative into the PR description, ensuring the PR declares `Closes #N` with auto-merge armed, and posting the handoff comment. Use when the user says a work item is complete or asks to close it out.
allowed-tools: Read, Edit, Grep, Glob, Bash
argument-hint: "[issue number]"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /phase-done

The closing step of the issue workflow (`.claude/rules/issue-workflow.md`).
Run it only once the work is finished; it verifies and records, it does not
decide the work is done for you.

## Steps

1. **Identify the issue** (named in `$ARGUMENTS`, or the one this branch's PR
   declares `Closes #N` for) and read it with `gh issue view <n> --json
   title,body,comments --jq '.title, .body, (.comments[] | "--- comment
   ---", .body)'`.
2. **Acceptance criteria.** Every `## Acceptance criteria` box must be
   ticked and true. If any remain `- [ ]`, stop and list them. Never tick a
   box yourself to proceed; a tick reflects a command someone ran and saw
   pass. If a criterion turned out unclear, or the draft requirement behind it
   changed, the owner's decision is recorded on the issue before the close.
3. **Definition of Done (`CLAUDE.md`).** Confirm, with evidence:
   - the acceptance criterion is met, shown in a test or a demo;
   - new code has unit tests and `pnpm check` is green; `pnpm test:coverage`
     holds the 70% core bar; `pnpm test:e2e` (with axe) is green for any UI
     change (`/ui-gates`);
   - a role-scoped change has its negative role tests (`auth-security.md`);
   - an integration change ran in the Compose test environment;
   - `docs/` is updated if the architecture changed, and the ArchiMate model
     change is flagged for the owner.

   Anything missing stops the close; say what.
4. **Relationships** (`scripts/gh/rel.sh tree <n>`): a parent with open
   sub-issues is not closed. Note the dependents this close unblocks.
5. **Changelog:** a user-visible change has a fragment
   `changelog.d/<issue>-<slug>.<section>.md` (`.claude/rules/changelog.md`);
   otherwise the PR carries `no-changelog`.
6. **Close narrative in the PR description:** what shipped, the requirement
   IDs it serves, key decisions with their citations, the gate results, what
   was left out (with follow-up issue numbers), and "Changed after review:
   …" if review changed it (`ai-code-review.md`). No attribution of any kind.
7. **Handoff comment on the issue** (`gh issue comment <n>`): where things
   stand, what was left out, what a follow-up session does first.
8. **The PR body declares `Closes #<n>`** (one keyword per issue), and
   auto-merge is armed: `gh pr view <pr> --json autoMergeRequest`; if null,
   run `gh pr merge <pr> --auto` as its own command.
9. **Board:** after the merge, `scripts/gh/project.sh show <n>` says `Done`
   (set by the workflow, never by hand).

## What this skill does not do

It does not run the gates to "check" the criteria for you; run them first
(`pnpm check`, `/ui-gates`) and paste the results.
