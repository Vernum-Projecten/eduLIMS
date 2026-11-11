<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Machine review: advisory, never authority

eduLIMS is built with an AI code assistant (Claude Code), and the plan of
approach makes that development line a deliverable in its own right. The risk
analysis scores "AI-codeassistent schrijft onveilige code" at 4 and answers
it with one measure: no merge without review and green tests. Machine review
(CodeQL, GitHub code scanning, Dependabot alerts, a Claude review agent such
as `security-reviewer` or `ui-reviewer`, the `/code-review` and
`/security-review` commands) is a second opinion beside the local gates. It is
not authority, and it gates no merge on its own.

## Precedence: a finding never outranks the sources

1. The published specifications in their domain: openEHR and HL7 for the
   integrations (`integration.md`), WCAG 2.1 for accessibility, OWASP for
   security.
2. The owner's decisions and the hard rules: `CLAUDE.md` and the
   `.claude/rules/*.md`.
3. The local and CI gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`, the
   coverage bar, the axe scan, the dependency scan.
4. The analyzer or review agent.

The requirements in `docs/requirements.md` are a working draft under
discussion with the product owner. A finding that hinges on a requirement
cites its ID, and when the requirement is unclear or conflicts with the code,
the question goes to the owner; neither the finding nor the draft settles it.
A finding that asks for something the rules forbid is wrong by construction. Nothing it reports relaxes `testing.md`:
never weaken a test because a finding suggested it.

## Rules

- **Findings are acted on by hand, in a normal change**, never applied through
  a UI that commits as a bot (the no-attribution rule has no exceptions).
- **A wrong finding is data, not a silent suppression.** Record it on an
  issue or in the PR, and suppress it only with a scoped `biome-ignore` that
  carries its reason (`typescript-style.md`).
- **Every AI-written change passes the same pipeline** as hand-written code:
  unit tests, data tests, the dependency scan (the test strategy, section
  "Testing the AI part").
- **The review count is measured.** The owner tracks how many AI pull requests
  needed changes at review, as evidence for the milestone review. A PR that
  changed after review says so in its description ("Changed after review:
  …"), in plain words and without attribution.

## Review agents in this repository

- `security-reviewer`: OWASP Top 10 and role leakage (S7, D3) on a diff.
- `ui-reviewer`: WCAG 2.1 AA and shadcn/ui use on a diff.

Both are read-only and return ranked findings with citations. The author
fixes or rebuts each finding in the PR.
