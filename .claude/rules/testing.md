---
paths:
  - "src/**"
  - "tests/**"
  - "vitest.config.ts"
  - "playwright.config.ts"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Testing discipline

The test strategy (`docs/test-strategy.md`) ties every test to an acceptance
criterion of the requirements, so each requirement can show it is
met. This file turns that strategy into rules for the code. The requirements
and their criteria are a working draft (`docs/requirements.md`): a test cites
the ID it encodes, and when a criterion changes, the test changes in the same
PR that records the owner's decision. A criterion that is too vague to test
is a question for the owner, never a number you pick.

## The hard rule

- **Never** weaken, skip, or delete an existing test to make a build pass.
  No `.skip`, no `.only` on `main`, no loosened assertion, no lowered coverage
  threshold.
- **Never** edit a test to route around a bug it exposes. If the fix is
  unclear, leave it failing, mark it `it.fails` with a `// TODO(#N):` naming
  its issue, and say so in the PR.
- A test that encodes an acceptance criterion cites it in its name or a
  comment (`it("rejects an Excel with an unknown sample ID (S4)", …)`). Never
  adjust an expectation to match an implementation bug.

## Levels (from the test strategy)

| Level | What | Tool | Where | Runs |
|---|---|---|---|---|
| Unit | Core rules: final grade from the rubric (D4), the five KPIs (D5), deadline and lock after submit (S6), sample-ID generation (S3) | Vitest | `*.test.ts` next to the code, or `tests/unit/` | every change (`pnpm test`) |
| Data | Gen5 Excel: sample IDs, well positions, empty and duplicate values (S4); Afinion HL7 to openEHR (S5) | Vitest with the fixed good and bad files | `tests/unit/` with `tests/fixtures/` | every change |
| Integration | eduLIMS with FerroEHR (REST, AQL), FerroBRIDGE with an HL7 message, sign-in | Vitest or Playwright against the Compose test stack; the HL7 message is simulated | `tests/integration/` | every release |
| Security | Role isolation: a student sees nothing of others, a teacher only their own classes; vulnerable libraries | role-scoped negative tests with test accounts; dependency scan in CI | next to the server function | every change and every release |
| Accessibility | Student, Teacher and Admin portals and the dashboard | Playwright + `@axe-core/playwright`, plus a keyboard-only pass | `tests/e2e/` (`pnpm test:e2e`) | every change in CI, before every milestone review |
| Performance | Page load and Excel upload with a full practical of test data | Playwright timings in the test stack | `tests/e2e/` | before every milestone review |

## Coverage is a mandate

- **The core holds at least 70% line, branch, function and statement
  coverage** (requirements, "Onderhoudbaarheid"; `vitest.config.ts`
  thresholds). `pnpm test:coverage` fails below it, and the bar only ratchets
  up.
- The core is `src/server/` and `src/lib/`: grading, KPIs, deadline and
  locking, upload parsing and validation, the openEHR mapping, the role
  checks. Route components are covered by e2e, not by unit coverage.
- Every acceptance criterion of a Must has at least one test. **A Must
  requirement with no test is a coverage gap, never an acceptable
  omission.**
- Every refusal is an asserted negative test: an unknown sample ID, an
  invalid well (`A13`, `I01`), an empty column, a submission after the
  deadline, an edit after submit, a cross-role read. A silently loosened check
  must fail the build.
- One behaviour per case; many small cases beat one broad case.

## The fixed test set

The test strategy: "Ik test nooit met echte persoonsgegevens." The repository
carries one fixed, pseudonymised test set under `tests/fixtures/` that every
test and every seed uses:

- invented students with pseudonyms (no real names, no real student
  numbers, no real e-mail addresses; use `@example.test`), one teacher per
  role scenario, one administrator; the development users are
  `student@example.test`, `teacher@example.test` and `admin@example.test`;
- one practical with an assignment, a protocol, a deadline and a rubric;
- measurement values for HbA1c, CRP (Afinion 2) and absorbance per well and
  wavelength (Epoch 2);
- deliberately bad files: a Gen5 Excel with an unknown sample ID, one with a
  well position that does not exist, one with an empty column;
- a simulated Afinion HL7 v2 ORU message per analyte.

Add to the set when a case needs it; never replace it with generated random
people. Fixtures are synthetic, so they can be committed.

## End-to-end and accessibility

- Playwright (`pnpm test:e2e`) drives the built app against the Compose test
  stack, signed in through a test identity provider or a test-only session
  seed, never against a real institution tenant.
- **Every route runs an axe scan** with the WCAG 2.1 A and AA tags
  (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) and asserts zero violations
  (<https://playwright.dev/docs/accessibility-testing>). A known violation is
  fixed, never excluded from the scan.
- Each portal has a keyboard-only journey (Tab, Shift+Tab, Enter, Space,
  Escape) through its main task.
- Assert on what the user sees (roles, labels, the English source text),
  never on CSS classes or test ids where a role or label exists. One journey
  per portal also runs in the `nl` locale, so a missing Dutch message shows.

## Unit test shapes

- Vitest with `describe`/`it`, `expect` with specific matchers (`toEqual`,
  `toThrow(ErrorClass)`), never a bare `toBeTruthy` for a value check.
- Pure core logic (grading, KPIs, the Gen5 parser) is written as plain
  functions without I/O, so it tests without a database.
- Database tests run against a real PostgreSQL 18, each in a transaction
  rolled back after the case: `createTestDb()` (`src/server/db/test-db.ts`)
  in the test, `destroy()` in `afterEach`. The database is `edulims_test` on
  the dev stack (`TEST_DATABASE_URL`; a service container in CI), emptied and
  migrated once per run by the Vitest global setup, never the `edulims`
  development database. Do not mock Kysely.
- External HTTP (FerroEHR, FerroBRIDGE health) is stubbed at the HTTP layer
  in unit tests, and exercised for real in the integration level.
- Component tests use Testing Library queries by role and label.

## Target

Typed, lint-clean, tested increments at all times; `pnpm check` green is the
standing bar.
