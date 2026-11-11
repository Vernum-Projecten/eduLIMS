<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Issue workflow (the tracker loop)

**The tracker is GitHub Issues on `Vernum-Projecten/eduLIMS`: the open issue
list IS the worklist.** The whole development line is on GitHub (Issues,
Actions, GHCR; ADR 0002), so Azure DevOps is never used. Issue state is edited only through `gh`; never track work
only in chat. This file is the loop, the label taxonomy, and the cadence.
Relationships between issues live in `issue-relationships.md`; the board is
`project-board.md`.

## The loop

1. **Orient.** `gh issue list --state open` (the SessionStart hook injects it,
   annotated with `<Type/Priority>`, sub-issue progress `{k/n}`,
   `child-of #parent`, and open `BLOCKED-by`/`blocks` edges). Pick the pinned
   issue (pins = current focus, max 3) or the issue the user names; **skip an
   issue shown `BLOCKED-by` an open issue** (work its blocker first) and prefer
   the next open child of a parent. Among the candidates the `Priority` field
   decides the order (`Urgent`, `High`, `Medium`, `Low`), oldest first within a
   priority; with no priority field, a Must requirement goes before a Should,
   a Should before a Could.

   **Never read an issue with `gh issue view <n> --comments`.** It prints
   nothing and exits 0 for an issue with no comments, so the contract comes
   back empty and nothing says so. Every reader uses:

   ```sh
   gh issue view <n> --json title,body,comments \
     --jq '.title, .body, (.comments[] | "--- comment ---", .body)'
   ```
2. **Read the contract.** The issue body opens with a plain summary (no
   heading: what and why), then a `Requirement:` line naming the requirement
   IDs it serves (S1 to S9, D1 to D8, B1 to B4, or a quality requirement such as
   `Q-ACC-1`), then `## Acceptance criteria` as a checklist. A Must
   issue quotes the current draft acceptance criterion of its requirement from
   `docs/requirements.md` and adds the engineering criteria under
   it. **The requirements are a working draft under discussion with the
   product owner.** When a requirement is unclear, missing, or conflicts with
   what the issue asks for, comment the question on the issue and ask the
   owner before building; never fill the gap with an invented requirement.
   New work discovered en route gets its own issue, **linked** with
   `scripts/gh/rel.sh` (a sub-issue of the issue it decomposes, or a
   `blocked-by` edge for real sequencing), never a prose "see also".
3. **Do the work.** At pickup, move the issue to `In Progress` on the board
   (`scripts/gh/project.sh status <n> in-progress`). First read the governing
   requirement (`/requirement-lookup`) and, for an integration, the governing
   specification (`integration.md`). Build typed, tested increments.
4. **Record progress on the issue.** Tick verified acceptance criteria
   (`gh issue edit <n> --body-file`), post status and decisions as comments
   (`gh issue comment <n>`); the issue thread is the durable record.
5. **Commit on a conventional-type branch** with a conventional commit
   subject. The PR body declares `Closes #<n>` so the merge into `main` closes
   the issue (never close by hand when a PR carries the work). One `Closes`
   keyword closes one issue: "Closes #1, #2" closes only #1, so repeat the
   keyword per issue. Arm auto-merge the moment the PR is open, as its own
   command: `gh pr merge <n> --auto`, which adds it to the merge queue.
6. **Close out** with `/phase-done`: verify the Definition of Done
   (`CLAUDE.md`), write the close narrative into the PR description, post the
   handoff comment on the issue.

## Type, priority and labels

**The type of an issue is GitHub's native issue type, never a label.** The
`Vernum-Projecten` organisation defines `Bug`, `Feature` and `Task`. Priority
is the organisation's `Priority` issue field (`Urgent`, `High`, `Medium`,
`Low`) where the organisation defines it; the SessionStart dump prints `?`
when it is missing.

| Fact | Where it lives | Values | Command |
|---|---|---|---|
| Type | the native issue type | `Bug`, `Feature`, `Task` | `scripts/gh/fields.sh type <n> bug\|feature\|task` |
| Priority | the organisation's `Priority` issue field | `Urgent`, `High`, `Medium`, `Low` | `scripts/gh/fields.sh priority <n> urgent\|high\|medium\|low` |
| Requirement | the `Requirement:` line of the body | `S1` to `S9`, `D1` to `D8`, `B1` to `B4`, a quality requirement | `gh issue edit <n> --body-file` |

File every issue with `scripts/gh/fields.sh new <type> <priority> <gh issue
create args…>`, which sets the type (and priority, when the field exists) at
creation. Until that helper exists, `gh issue create` followed by setting the
type in the web UI is the fallback; never leave an issue without a type.

The priorities read: `Urgent` is drop everything (a broken login, a role
leak), `High` is the current milestone's focus, `Medium` is normal, `Low` is
someday. The type maps to the conventional-commit type of the branch and the
commit: a `Bug` is a `fix`, a `Feature` is a `feat`, and a `Task` says which
one it is with exactly ONE work-kind label.

Labels carry what the platform has no field for. Keep the set small and
bootstrap it with `scripts/gh/labels.sh`:

- **Work kind, on a `Task` only, exactly ONE:** `documentation`, `chore`,
  `refactor`, `perf`, `test`, `ci`.
- **Portal:** `portal:student`, `portal:teacher`, `portal:admin`.
- **Area:** `auth`, `database`, `upload` (Gen5/Epoch Excel), `openehr`
  (FerroEHR REST and AQL), `hl7` (Afinion via FerroBRIDGE), `kpi`, `infra`.
- **Workflow:** `security`, `privacy`, `accessibility`, `dependencies`
  (Dependabot), `on-hold` (waits on an input nobody here can provide, such as
  the identity provider registration from the institution's IT department), and the PR escape hatch
  `no-changelog`. Blocked-ness is the native blocked-by edge, never a label.

## Milestones = releases

A milestone is a delivery promise (`vX.Y.Z`) with a due date that lines up
with a review with the product owner. A release is cut when its milestone reaches zero open
issues, or when the owner calls the cut and moves the stragglers to the next
milestone. Every en-route issue goes in the CURRENT milestone, never the next.
The cut procedure is `docs/release.md` (`/release`).

## The fix-first cadence

**An issue filed while working a unit is FIXED before the next unit starts.**
Review findings, guard gaps, en-route defects: filing the issue is the record,
never permission to move on. Tractable findings are fixed in the same branch;
separable work becomes a linked issue that is closed before the current
program advances.

## Branches use conventional types

`<type>/<kebab-case-slug>` with `type` in `feat` | `fix` | `chore` | `docs` |
`refactor` | `perf` | `test` | `ci` | `build` | `release`: for example
`feat/sample-registration`, `fix/upload-well-validation`. Branch from
`origin/HEAD` (`git fetch origin && git switch -c <type>/<slug> origin/HEAD`),
stage named paths (`git add <files>`, never `git add -A` from the root), and
never force-push `main`.

## Durable vs session-scoped

Issues and git survive `/clear` and `/compact`; the built-in todo tool is
session-scoped, so the tracker is the durable layer. Record progress (tick
checkboxes, comment, open issues for new work) and commit before ending a
session.

## Never add AI/Claude attribution

Commit messages, PR text, issue and comment bodies describe only the change
itself: no `Co-Authored-By` trailer, no "Generated with" footer, no robot
emoji, no `ai-assisted` label. This is an absolute owner rule with no
exceptions, and `.claude/hooks/no_attribution_guard.sh` blocks a commit or PR
command that carries one.
