<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Issue relationships (GitHub native sub-issues and dependencies)

The tracker is GitHub Issues (`issue-workflow.md`). GitHub exposes native
issue relationships, and this repository uses them as tracker structure
instead of describing structure in prose. This file is the policy (when to use
each) and the canonical commands. The one sanctioned write path is
`scripts/gh/rel.sh`.

## Two facts that dictate everything below

1. **`gh` has no subcommand** for sub-issues or dependencies. Every
   relationship goes through `gh api`, or, preferably, `scripts/gh/rel.sh`,
   which wraps the correct endpoints.
2. **Write endpoints take the issue's database `id`, not its `#number`.** The
   POST and DELETE bodies want `sub_issue_id` / `issue_id` as the numeric
   database id, which is not the `#12` you see in the UI. `scripts/gh/rel.sh`
   resolves `#number` to `id` and fails loud on a bad number, so always prefer
   it over raw `gh api` for writes. Reads are `#number`-keyed.

## The command surface: `scripts/gh/rel.sh`

| Intent | Command |
|---|---|
| Make #child a sub-issue of #parent | `scripts/gh/rel.sh parent <child> <parent>` |
| Move #child to a new parent | `scripts/gh/rel.sh parent <child> <parent> --replace` |
| Detach #child from its parent | `scripts/gh/rel.sh unparent <child>` |
| #n is blocked by #blocker | `scripts/gh/rel.sh blocked-by <n> <blocker>` |
| Remove "#n blocked-by #blocker" | `scripts/gh/rel.sh unblock <n> <blocker>` |
| #n blocks #blocked | `scripts/gh/rel.sh blocking <n> <blocked>` |
| Show every relationship of #n | `scripts/gh/rel.sh tree <n>` |
| Print the database id of #n | `scripts/gh/rel.sh id <n>` |

## When to use each

### Parent and sub-issue (decomposition)

A parent breaks into sub-issues that roll up into a progress bar (visible in
the SessionStart dump, `/phase-status`, and the board). Limits: at most 100
sub-issues per parent, 8 nesting levels, one parent per issue.

Use it to split a requirement that is too big for one PR into closeable
pieces: "S4 Gen5-export uploaden en valideren" becomes the parser, the
sample-ID and well validation, the openEHR composition write, and the
Studentportaal upload screen, each with its own acceptance criteria. A
requirement with one PR of work needs no parent.

Milestones stay the release spine. Do not create per-release "epic" parents:
sub-issues express decomposition, milestones express release.

### Blocked-by and blocking (sequencing)

#n cannot start or finish until its blockers close. Use it for real in-repo
sequencing: the role model (B1) blocks the role-scoped result view (D3); the
sample registration (S3) blocks the upload validation (S4). Write it in
either direction; GitHub stores one edge.

An external wait with no issue here (the Entra app registration from Hanze
ICT, the lab network route to the VNET) is the `on-hold` label, never a
`blocked-by` edge.

### Security alerts (UI only)

A code-scanning alert links to an issue only through the web UI (Security
tab, the alert, Tracking). There is no API, so `rel.sh` does not cover it.

## No duplication: a relationship lives in exactly ONE place

- **A parent's body never lists its sub-issues.** The Sub-issues panel is the
  single source of truth; a body checklist of children double-books the
  progress bar.
- **A body never lists its blockers or what it blocks.** The Dependencies
  panel is canonical.
- **A parent's acceptance criteria are outcomes** (the requirement's
  acceptance criterion), not a roll-call of children.
- **Prose may name an issue only when it is not a native edge:** "supersedes
  #X", "context in #Y".

## Interaction with the rest of the workflow

- `/next-task` skips issues with open blockers and, for a parent, points at
  the next open child.
- `/phase-done` refuses to close a parent with open children.

## Official documentation

- Sub-issues REST API: <https://docs.github.com/en/rest/issues/sub-issues>
- Issue dependencies REST API: <https://docs.github.com/en/rest/issues/issue-dependencies>
- Adding sub-issues: <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues>
- Creating issue dependencies: <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies>
