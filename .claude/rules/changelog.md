---
paths:
  - "CHANGELOG.md"
  - "changelog.d/**"
  - "SECURITY.md"
  - "docs/release.md"
  - ".github/workflows/release*.yml"
  - "scripts/release/**"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Changelog discipline (Keep a Changelog 1.1.0)

`CHANGELOG.md` is the release record (<https://keepachangelog.com/en/1.1.0/>
plus SemVer <https://semver.org/spec/v2.0.0.html>), and the GitHub release
notes are cut from it. Nobody edits `CHANGELOG.md` in a feature PR: two PRs
editing the same `[Unreleased]` section conflict in the merge queue. A change
with a user-visible effect adds a **fragment** under `changelog.d/` instead,
and the release cut assembles the fragments into the new version's section
(`docs/release.md`, `/release`).

## Fragments

- **Name:** `changelog.d/<issue>-<kebab-slug>.<section>.md`, for example
  `changelog.d/42-upload-well-validation.fixed.md`. The format and the
  assembler are described in `changelog.d/README.md`.
- **Section** is one of the six Keep a Changelog types, lower case: `added`,
  `changed`, `deprecated`, `removed`, `fixed`, `security`. No other heading
  exists.
- **Content:** one or two sentences in English, written for the person who
  uses or runs eduLIMS (a teacher, an administrator, the person who deploys the
  Compose stack): what changed for them, and the upgrade step when a change
  breaks something (a new environment variable, a migration). Name the
  requirement ID when the change delivers one ("Students can upload a Gen5
  export and see each rejected well (S4).").
- **A change with no user-visible effect** (a refactor, a test, CI, the
  `.claude/` setup) carries the `no-changelog` label on the PR instead of a
  fragment. The changelog guard in CI fails a PR with neither.

## Security entries

- A `security` fragment names the advisory it fixes: the `GHSA-…` id of the
  repository advisory, or the CVE or GHSA of the upstream package for a
  dependency bump.
- A security fix ships as its own patch release when it can. When it ships
  beside functional changes, the release section says why in its first line
  under `### Security`.
- Never write exploit details into a fragment before the advisory is
  published.

## Never

- Never edit a released section of `CHANGELOG.md`. A wrong entry is
  corrected by a new entry in the next release.
- Never add AI or Claude attribution to a fragment or a release note.
