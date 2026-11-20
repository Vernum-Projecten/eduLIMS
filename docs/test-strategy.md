<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Test strategy

This strategy describes how eduLIMS is tested. Every test belongs to an
acceptance criterion in [requirements.md](requirements.md), so each
requirement can be shown to be met. All automated tests run in GitHub
Actions ([ADR 0002](adr/0002-github-instead-of-azure-devops.md)).

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
| Unit | Rules in the core: turnaround time (G-01), accuracy status from the teacher's limits as a percentage or an absolute distance, with a value exactly on a limit at the better colour (G-03, D13), the check against the team's own tolerance, no release without a tolerance and the tolerance kept at the release (S13, S15), the lab number unique across the teams and different for the same sample number twice in a lab (S12), corrections to a patient or a request only until the first release, with the time of entry unchanged (S11, S12), and one final release per requested test (S15). Urgent within target (G-02) and the ranking (G-04) are not built in this iteration (D12, D14), so they have no tests yet | Vitest | every change, in CI | all tests green; core coverage at least 70% (Q-MAINT-1) |
| Data | Excel upload: the Gen5 layout, a header block and a 96-well grid of absorbance values at one wavelength (S4). Afinion: HL7 message to openEHR | a fixed set of good and bad test files; validation against the template `eduLIMS-lab` | every change, in CI | a file in another layout is rejected with a clear message; a good file is read and its values are shown to the team; a composition passes validation against the template |
| Integration | eduLIMS with FerroEHR (REST and AQL), FerroBRIDGE with an HL7 message, sign-in through Microsoft Entra ID or Keycloak | a test environment with Docker Compose; the HL7 message is simulated | every pull request that touches the integration code or the Compose stack, and nightly on `main` (the CI integration lane, [ci-cd.md](ci-cd.md)) | a measurement appears with the right sample in the team's work within 1 minute (S5); it finds its team through the lab number the team enters as the patient ID on the Afinion 2 (S5, S12) |
| Security | Lab isolation: a student sees no work of another lab, a teacher only their own simulations, including those another teacher added them to (S10, D10, Q-SEC-2). The administrator's read-only view holds no work of a lab and no correct value (B5). No hint: no server response for a student account carries a correct value or an accuracy status (Q-SIM-1). Vulnerable libraries (Q-SEC-4) | test accounts per role and per team, with negative tests on every function that touches a correct value; OWASP Top 10 checklist (Q-SEC-1); dependency and image scan in CI | every release | no access outside the own role and the own team; no correct value in a student response; no known critical vulnerabilities |
| Performance | Page load time and Excel upload processing (Q-PERF-1, Q-PERF-2) | measured in the test environment with a full simulation of test data | before every milestone review | pages within 2 seconds; upload within 10 seconds |
| Accessibility | Student portal, teacher portal and the dashboard (Q-ACC-1 to Q-ACC-3) | axe scan in Playwright, and a keyboard-only walkthrough | axe on every change; keyboard before every milestone review | no errors at WCAG 2.1 level A and AA |
| User test | The teacher dashboard with 3 to 5 teachers, the student portal with 2 to 3 students | think-aloud test with fixed tasks on an invented simulation, such as "which team released a result that is red?" | after every design iteration | at least 4 of 5 tasks completed without help |
| Acceptance | The Must requirements | demo to the product owner in the milestone review | every milestone | the product owner accepts the acceptance criterion |

Every server-route contract (a `server.handlers` route, such as the better-auth
handler under `/api/auth/*`, the SCIM endpoint or a file download) has at least
one test over HTTP against the built server, for each method it serves. A test
that calls `auth.handler` or the handler function directly cannot see the
routing in front of it: SCIM `PUT`, `PATCH` and `DELETE` passed every such test
while the route served only `GET` and `POST` (#365).

### Tools

| Level | Tool |
|---|---|
| Unit, data | Vitest (with jsdom and Testing Library for components), `@vitest/coverage-v8` |
| Integration | Vitest against the Compose test stack (PostgreSQL 18, FerroEHR); a simulated HL7 sender for FerroBRIDGE |
| End-to-end, accessibility | Playwright with `@axe-core/playwright` |
| Security | role tests in Vitest and Playwright; in CI ([ci-cd.md](ci-cd.md)): `pnpm audit` and OSV-Scanner on dependencies, CodeQL (`security-extended`) on the code and workflows, Trivy on the pushed image, zizmor and actionlint on the workflows, and OpenSSF Scorecard on the repository |

## Test data

eduLIMS is never tested with real personal data (Q-PRIV-3). The repository
holds a fixed test set:

- invented students under pseudonyms, in invented labs;
- fictional patients, invented for the test set;
- one invented simulation with invented correct values;
- measured values in the formats the analysers deliver: an HL7 v2 message of
  the Afinion 2 and a Gen5 export of the Epoch 2;
- deliberately bad files, such as an Excel file in another layout than the
  Gen5 export.

Everyone runs the same tests on the same set.

The teachers' real simulation material is never used as a fixture (Q-PRIV-4,
R-13): no scenario, patient list, request form or correct value of a real
simulation is in the repository, a test or the demo data. A fixture copies the format of the
material and none of its content.

## Testing the AI part

The AI part of the project is the development lane with Claude Code. The
tests do not test the language model; they test whether the code that comes
out is good enough.

- Every AI change goes through the same pipeline as any other code: unit
  tests, data tests and the dependency scan.
- The change is merged only through a pull request and the merge queue with
  green CI. Review by a person is a convention, not a gate: the branch rules
  require no approval, so a pull request can auto-merge once CI is green. By
  convention a reviewer looks at the change and every review comment is
  resolved before merging ([GOVERNANCE.md](../GOVERNANCE.md#merging)).
- The maintainer counts how many AI pull requests needed changes in review.
  That shows in the milestone review whether the AI assistance helps.

## Definition of Done

A user story is done only when all of the following hold. The same list is in
`CLAUDE.md`, so the AI coding assistant follows the same rules.

- [ ] The acceptance criterion from [requirements.md](requirements.md) is met.
- [ ] The new code has unit tests, and every test in the pipeline is green.
- [ ] The pull request has been reviewed by convention and every review comment
      is resolved.
- [ ] The change is tested in the test environment.
- [ ] The architecture documentation is updated if the architecture changed.

## Reporting

Test results are kept per run in GitHub Actions. Every milestone review shows
which tests were added and what went wrong.
