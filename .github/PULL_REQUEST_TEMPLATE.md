<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

<!--
The title is a Conventional Commits header, for example
`feat(upload): refuse an unknown well position`. The merge queue squashes the
pull request into one commit with this title and description.
-->

## What changed and why

<!-- The change and the reason for it. Keep it to what a reviewer needs. -->

Closes #

## Definition of Done

From the test strategy: a story is done when every item holds.

- [ ] The acceptance criterion of the requirement is met, and the description says how it was shown.
- [ ] The new code has unit tests, and coverage of the core stays at 70% or more.
- [ ] CI is green (`conclusion`).
- [ ] The change is tested in the test environment.
- [ ] The docs are updated if the architecture changed.

## Checklist

- [ ] Local gates pass: `pnpm check`, and `pnpm test:e2e` when a screen or a flow changed.
- [ ] A screen that changed passes the axe scan and a keyboard-only walk-through (WCAG 2.1 AA).
- [ ] No real personal data in code, tests, fixtures, or screenshots.
- [ ] A changelog fragment under `changelog.d/` records a user-visible change; otherwise the pull request carries `no-changelog`.
- [ ] The `--self-test` of every `scripts/` helper the change touched passes.
- [ ] Every commit is signed.
