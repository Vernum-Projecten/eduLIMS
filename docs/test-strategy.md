<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Test strategy

This strategy describes how eduLIMS is tested. Every test belongs to an
acceptance criterion in [requirements.md](requirements.md), so each
requirement can be shown to be met. It is a translation of the owner's
*Teststrategie eduLIMS*, updated for the chosen tools and for GitHub Actions
([ADR 0002](adr/0002-github-instead-of-azure-devops.md)).

## Approach

eduLIMS is tested on three things: the data, the behaviour of the system, and
whether users can work with it. Most tests are automated and run on every
change in the GitHub Actions pipeline, so a break shows up at once, also when
the AI coding assistant wrote the code. User tests are manual, with real
teachers and students.

The pyramid starts at the bottom: many small, fast tests on single parts, and
fewer large tests on the whole system. Large tests are slower and harder to
repeat, so they cover the most important flows only.

## Test levels

| Level | What is tested | How | When | Passes when |
|---|---|---|---|---|
| Unit | Rules in the core: final grade from the rubric (D4), the five KPIs (K-01, K-04 to K-06, K-08), deadline and locking after sending (S6), sample ID uniqueness (S3) | Vitest | every change, in CI | all tests green; core coverage at least 70% (Q-MAINT-1) |
| Data | Excel upload: sample IDs, well positions, empty or duplicate values (S4). Afinion: HL7 message to openEHR | a fixed set of good and bad test files; validation against the template `eduLIMS-lab` | every change, in CI | bad files are rejected with a clear message; good files reach FerroEHR correctly |
| Integration | eduLIMS with FerroEHR (REST and AQL), FerroBRIDGE with an HL7 message, sign-in through Entra ID | a test environment with Docker Compose; the HL7 message is simulated | every release | a measurement appears with the right sample within 1 minute (S5) |
| Security | Roles: a student sees no data of others, a teacher only their own classes (Q-SEC-2). Vulnerable libraries (Q-SEC-4) | test accounts per role; OWASP Top 10 checklist (Q-SEC-1); dependency and image scan in CI | every release | no access outside the own role; no known critical vulnerabilities |
| Performance | Page load time and Excel upload processing (Q-PERF-1, Q-PERF-2) | measured in the test environment with a full practical of test data | before every milestone review | pages within 2 seconds; upload within 10 seconds |
| Accessibility | Student portal, teacher portal and the dashboard (Q-ACC-1 to Q-ACC-3) | axe scan in Playwright, and a keyboard-only walkthrough | axe on every change; keyboard before every milestone review | no errors at WCAG 2.1 level A and AA |
| User test | Dashboard with 3 to 5 teachers, student portal with 2 to 3 students | think-aloud test with fixed tasks, such as "which class is behind?" | after every design iteration | at least 4 of 5 tasks completed without help |
| Acceptance | The Must requirements | demo to the product owner in the milestone review | every milestone | the product owner accepts the acceptance criterion |

### Tools

| Level | Tool |
|---|---|
| Unit, data | Vitest (with jsdom and Testing Library for components), `@vitest/coverage-v8` |
| Integration | Vitest against the Compose test stack (PostgreSQL 18, FerroEHR); a simulated HL7 sender for FerroBRIDGE |
| End-to-end, accessibility | Playwright with `@axe-core/playwright` |
| Security | the dependency and image scans in CI ([ci-cd.md](ci-cd.md)), role tests in Vitest and Playwright |

## Test data

eduLIMS is never tested with real personal data (Q-PRIV-3). The repository
holds a fixed test set:

- made-up students under pseudonyms, in made-up classes;
- one practical with a deadline and a rubric;
- measured values for HbA1c, CRP and absorbance;
- deliberately bad files: an Excel with an unknown sample ID, a well position
  that does not exist, and an empty column.

Everyone runs the same tests on the same set.

## Testing the AI part

The AI part of the project is the development lane with Claude Code. The
tests do not test the language model; they test whether the code that comes
out is good enough.

- Every AI change goes through the same pipeline as any other code: unit
  tests, data tests and the dependency scan.
- The supervising teacher then reviews the change in a pull request. Nothing
  reaches production without green tests and a resolved review.
- The developer counts how many AI pull requests needed changes in review.
  That shows in the retrospective whether the AI assistance helps.

## Definition of Done

A user story is done only when all of the following hold. The same list is in
`CLAUDE.md`, so the AI coding assistant follows the same rules.

- [ ] The acceptance criterion from [requirements.md](requirements.md) is met.
- [ ] The new code has unit tests, and every test in the pipeline is green.
- [ ] The supervising teacher has reviewed the pull request and every comment
      is resolved.
- [ ] The change is tested in the test environment.
- [ ] The ArchiMate model and the documentation are updated if the
      architecture changed.

## Reporting

Test results are kept per run in GitHub Actions. Every milestone review shows
which tests were added and what went wrong.
