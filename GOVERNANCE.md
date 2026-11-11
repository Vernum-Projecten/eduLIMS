<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Governance

How decisions get made in eduLIMS, who makes them, and how that changes.

## Roles

| Role | Who | Decides |
|---|---|---|
| Client and product owner | Sophie de Klerk, senior researcher Health Informatics | priorities in the backlog, acceptance of each requirement in the milestone review |
| Overseeing party | the research group New Business & ICT (lector) | continuity of eduLIMS and its development lane inside the CollabSpace |
| Maintainer | Ruben Talstra ([MAINTAINERS.md](MAINTAINERS.md)) | technical decisions: what gets merged and released, and how |
| Reviewer | the supervising teacher | reviews pull requests by convention; see below |
| Users | LifeScience teachers, students, and the lab and application administrator | feedback in interviews, user tests and issues |

The product owner decides what is built. The maintainer decides how. When the
two meet (a requirement that cannot be met as written, or a technical choice
that changes what users see), the maintainer brings it to the next milestone
review.

## Merging

Every change reaches `main` through a pull request and the merge queue, with
green CI. The branch rules require no approval, because the project has one
developer and a hard approval rule would block every merge when the reviewer
is away. By convention the supervising teacher reviews pull requests; the
maintainer resolves every review comment before merging, and a change written
with an AI tool gets the same review as any other ("AI ondersteunt, mens
beslist", [ADR 0009](docs/adr/0009-no-ai-attribution-human-review.md)).

## Cadence

Work is planned in GitHub milestones and issues. Each milestone ends with a
review with the product owner and the supervising teacher. The research
group is updated per milestone.

## Where decisions are recorded

| Kind of decision | Where it lives |
|---|---|
| What to build, and why | the issue, with its requirement ID and acceptance criteria |
| Requirements and their acceptance criteria | [`docs/requirements.md`](docs/requirements.md) |
| An architecture or technology choice | a record in [`docs/adr/`](docs/adr/README.md) |
| The architecture itself | [`docs/architecture.md`](docs/architecture.md) and the ArchiMate model |
| How a change is made | the pull request |
| Pinned versions | [`docs/VERSIONS.md`](docs/VERSIONS.md) |

A decision that exists only in a chat, a meeting or an AI session is not
recorded. Write it down in one of the places above.

## Handover

eduLIMS is meant to outlive the student project. At handover the research
group names a new maintainer, who gets a row in
[MAINTAINERS.md](MAINTAINERS.md) and write access to the repository. The
documents above, `CLAUDE.md` and the ArchiMate model let a new developer or a
new AI session start from the same rules.

## Changing this document

By pull request, like any other change.
