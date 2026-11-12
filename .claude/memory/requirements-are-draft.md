---
name: requirements-are-draft
description: "The requirements (S1 to S9, D1 to D8, B1 to B4, the NFRs, acceptance criteria, KPIs and their norms) are a working draft under discussion; cite IDs, flag gaps and conflicts, ask the owner, never invent or complete a requirement; owner 2026-11-11"
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The requirements in `docs/requirements.md` (MoSCoW) are **not final**: they
are under re-evaluation with the product owner, the teachers and the
students.

**Why:** the owner, 2026-11-11, during the bootstrap: the requirements are a
working draft, not the oracle. Building from them as fixed truth would bake
open questions into code and tests.

**How to apply:**

- Cite the requirement IDs an issue, a test or a PR serves; that keeps the
  trace.
- When a requirement is unclear, missing, or conflicts with what is being
  built, flag it and ask the owner (a comment on the issue, a question in the
  plan or the report). Do not pick a number, a rule or a scope yourself.
- An owner decision recorded on an issue is newer than the document.
- The external specifications stay authoritative in their own domain: openEHR
  and HL7 for the integrations, WCAG 2.1 AA for accessibility, OWASP for
  security.
- The owner wants the requirements, the architecture, the KPI dashboard and
  the test strategy **fully re-evaluated** (2026-11-11: "I feel this was not
  properly done … we should rethink all those things"). A critical review with
  63 findings exists; do not build a feature on an unsettled point.
- **Planning lives only in GitHub milestones and issues.** No backlog files,
  no sprint plans in the repository (the owner removed both, 2026-11-11).
  Issues are created from re-evaluated requirements, with the owner.
- **Exception, 2026-11-12 (the maintainer):** the LIMS-core issues (practicals,
  samples, FerroEHR, the Gen5 upload, the Afinion route, results, lab
  reports, grading, the KPI dashboard) are filed from the draft before the
  re-evaluation. Every issue that depends on an open product-owner question
  is `on-hold` and blocked by the one "Product-owner decisions" issue; only
  the parts no open question touches are built. An owner answer on that
  issue unblocks its dependents. These issues go in milestone v0.2.0;
  v0.1.0 first finishes the open foundation work (auth, classes, the
  Admin portal), and nothing LIMS-core starts before that.
