<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Changelog fragments

A pull request with a user-visible effect adds one file here instead of
editing `CHANGELOG.md`, so two pull requests never touch the same lines. A
pull request with no such effect carries the `no-changelog` label instead.

- **Name:** `<issue>-<kebab-slug>.<section>.md`, for example
  `42-sample-id-labels.added.md`. `<section>` is a Keep a Changelog 1.1.0
  section in lower case: `added`, `changed`, `deprecated`, `removed`, `fixed`
  or `security`. A change with no issue drops the number:
  `<kebab-slug>.<section>.md`.
- **Content:** the entry exactly as it reads in `CHANGELOG.md`: one or more
  list items that open with `- ` and continue on lines indented by two
  spaces, with no heading and no blank line inside. A fragment carries no SPDX
  header, because its text moves into `CHANGELOG.md`, which has one.
- **Issue reference:** the cut ends the first paragraph of each entry with
  `(#<issue>)`, the number the file name starts with, unless the entry already
  names that issue.
- **Audience:** write for the person who runs or uses eduLIMS: what changed
  for them, and the upgrade step when a change breaks something.

## Checks

- `scripts/release/changelog.sh --check` validates every fragment's name and
  content.
- `scripts/release/changelog.sh --preview` prints `CHANGELOG.md` with every
  fragment folded into `[Unreleased]`, as the next cut writes it.
- `scripts/release/changelog.sh --check-preview` runs the Keep a Changelog
  structure check over that preview.
- `scripts/release/changelog.sh --self-test` proves every mode on a stub
  repository.

The release cut runs `scripts/release/changelog.sh --assemble <version>
<date>`, which moves the fragments into `CHANGELOG.md` under the new version
and deletes them (`docs/release.md`). This README is not a fragment.
