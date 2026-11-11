<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# The roadmap board (GitHub Project v2)

The tracker is GitHub Issues (`issue-workflow.md`); milestones are the release
spine; the native issue type and the `Priority` field carry type and
priority; native edges carry decomposition and sequencing
(`issue-relationships.md`). The **"eduLIMS Roadmap"** Project under the
`Vernum-Projecten` organisation exists so the product owner, the supervisor
and the lectoraat see what is planned, in progress and shipped without reading
the raw issue list. It is a **view over the tracker, never a second tracker.**
The one sanctioned write path is `scripts/gh/project.sh`, which finds the
board by title (so a recreated board needs no edit) and needs the `project`
token scope (`gh auth refresh -s project`).

## The one-datum rule

**Status (`Todo` / `In Progress` / `Done`) is the ONLY board-managed datum.**
Everything else the board shows is read from the issue:

| Fact | Canonical home | Never duplicated as |
|---|---|---|
| Type | the native issue type | a board Type field |
| Priority | the organisation's `Priority` issue field | a board Priority field |
| Requirement | the `Requirement:` line and the portal label | a board Requirement field |
| Release | the `vX.Y.Z` milestone | a board Release or Iteration field |
| Decomposition | native sub-issue edges | a board hierarchy field |
| Sequencing | native blocked-by edges | a Blocked column |

Do not add custom fields, sprint iteration fields, estimate fields, or extra
Status options. A board-only fact is invisible to `gh issue` consumers and
rots the first time it disagrees with the issue. The one derived field is
`Target date`, the mirror of the milestone due date, written only by
`scripts/gh/project.sh sync-dates`.

## Status semantics and who moves it

- **`Todo`:** every open issue starts here (the auto-add workflow sets it).
- **`In Progress`:** set at pickup with `scripts/gh/project.sh status <n>
  in-progress`; `/next-task` does this as its last step. It is the one manual
  move.
- **`Done`:** never set by hand. The PR's `Closes #N` closes the issue and the
  built-in "item closed" workflow moves it.

An issue parked mid-flight goes back with `scripts/gh/project.sh status <n>
todo`; a stale `In Progress` card is a false claim in the sprint review.

## Commands

| Intent | Command |
|---|---|
| Start work on #n | `scripts/gh/project.sh status <n> in-progress` |
| Park #n | `scripts/gh/project.sh status <n> todo` |
| Add #n (auto-add missed it) | `scripts/gh/project.sh add <n>` |
| Read #n's status | `scripts/gh/project.sh show <n>` |
| Print the board by column | `scripts/gh/project.sh board` |
| Post a status update | `scripts/gh/project.sh update <on-track\|at-risk\|off-track\|complete> "<markdown>"` |
| Sync Target date from milestones | `scripts/gh/project.sh sync-dates` |

Never `gh project item-edit` raw, never archive or delete items: closed items
stay visible as the shipped record.

## Status updates

Post one at every release cut and at every sprint review: what shipped, which
requirement IDs it moved, what the next milestone targets. Write for the
product owner: no internal file paths, and numbers only when they come from a
committed artefact (the coverage report, the axe run).

## Board configuration (for the owner creating it)

Fields: the built-in `Status` with exactly `Todo` / `In Progress` / `Done`,
plus a Date field `Target date`. Views: **Board** (grouped by Status, sliced by
Milestone), **Roadmap** (by `Target date`, grouped by Milestone), **Current
focus** (table, `is:open priority:Urgent,High`). Built-in workflows: auto-add
(`is:issue is:open` to Todo), item reopened to Todo, item closed to Done. Keep
auto-close and auto-archive off.

## Official documentation

- gh project commands: <https://cli.github.com/manual/gh_project>
- Projects v2 API: <https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects>
- Built-in workflows: <https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations>
