---
name: next-task
description: Reads the tracker (GitHub Issues), picks the pinned or top open issue (or the issue the user names, skipping blocked ones), and restates it as a concrete in-session work plan naming the requirement IDs, files and gates involved. Use when the user asks "what's next" or "what should I work on".
allowed-tools: Read, Grep, Glob, Bash
argument-hint: "[issue number]"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /next-task

Turns an open tracker issue into an actionable plan, the planning step of the
issue workflow (`.claude/rules/issue-workflow.md`). It does not do the work;
that is a separate step after the plan is accepted.

## Steps

1. **Read the tracker.** The SessionStart dump lists the open issues with
   `<Type/Priority>`, `{k/n}` sub-issue progress, `child-of #parent` and open
   `BLOCKED-by`/`blocks` edges; re-run `.claude/hooks/session_start_issues.sh`
   if it is stale. Take the issue named in `$ARGUMENTS`, else the pinned
   issue, else the open, unblocked issue with the highest `Priority` (oldest
   first within a priority). Do not pick an issue shown `BLOCKED-by` an open
   issue: surface its blocker instead. For a parent, point at its next open
   child. An issue shown `<?/?>` has no type or priority yet: say so and set
   them (`scripts/gh/fields.sh`) before planning.
2. **Read the contract:**
   `gh issue view <n> --json title,body,comments --jq '.title, .body,
   (.comments[] | "--- comment ---", .body)'` (never `--comments`), plus
   `scripts/gh/rel.sh tree <n>` for its parent, children and blockers.
3. **Read the requirement.** Run `/requirement-lookup` for every ID on the
   issue's `Requirement:` line. The requirements are a working draft: if the
   draft and the issue disagree, the criterion is vague, or no requirement
   covers what the issue asks, list that as an **open question for the
   owner** in the plan. Never resolve it by inventing a requirement.
4. **Write the plan**, stating:
   - **What** the task requires, in one or two sentences, with its
     requirement IDs.
   - **Which files** are involved, found by searching (`src/routes/`,
     `src/server/`, `src/components/`, `tests/`), never guessed.
   - **Which rules govern it:** the `.claude/rules/*.md` files for the areas
     touched (`tanstack.md`, `react-ui.md`, `auth-security.md`,
     `database.md`, `integration.md`), and for an integration the
     specification section (openEHR ITS-REST 1.1.0, AQL, HL7 v2).
   - **Which skill scaffolds it**, if any: `/new-route`, `/new-form`,
     `/db-migration`.
   - **What done looks like:** the issue's acceptance criteria, the tests
     that prove each (unit, data, role isolation, axe e2e), and the
     Definition of Done in `CLAUDE.md`.
   - **Open questions for the owner**, if any. The plan waits on them only
     where the answer changes what gets built.
5. **When work starts** (the plan is accepted), move the issue to
   `In Progress`: `scripts/gh/project.sh status <n> in-progress`. If the
   board or the helper does not exist yet, say so and continue. Park it back
   to `todo` if the session stops unfinished.
6. **Do not edit the issue or commit** as part of planning.
