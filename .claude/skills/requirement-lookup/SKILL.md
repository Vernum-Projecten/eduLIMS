---
name: requirement-lookup
description: Finds a requirement by its ID in docs/requirements.md (an S, D or B requirement, a quality requirement Q-, a dashboard measure G-, a risk R- or an open question O-) and its current draft acceptance criterion, quotes it with its MoSCoW priority and its status, and flags where it is unclear, open, dropped, missing or in conflict with the task. Use before implementing, testing or reviewing behaviour a requirement covers, or when an issue cites a requirement ID.
allowed-tools: Read, Grep, Glob
argument-hint: "<requirement ID or topic, e.g. S15, D11, G-03, O5, WCAG>"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /requirement-lookup

Answer "what does the requirement say" from the text in the repository, never
from memory. **The requirements are a working draft**, still under
discussion with the product owner: the IDs, the MoSCoW priorities, the
acceptance criteria, the dashboard measures and their limits can all change. This skill
reports what the draft says today and where it falls short; it never settles
a question the draft leaves open.

## Where to look

1. `docs/requirements.md`: the terms, the requirement tables (Student
   portal S, Teacher portal D, Admin portal B, the Won't list W), the
   acceptance criteria, the quality requirements (ISO 25010, Q-), the risk
   table with its measures (R-), the dashboard measures (G-) and the open
   questions (O-). Search it with Grep for the ID (`\bS4\b`) and for the
   topic words (`tolerance`, `release`, `urgent`, `correct value`).
2. `docs/lims-workflow.md` for the chain from request form to released
   result, `docs/architecture.md` for where a requirement lands in the design
   (portals, databases, the openEHR template, the integrations), and
   `docs/game-dashboard.md` for the teacher dashboard.
3. The closed and open issues that cite the ID
   (`gh issue list --state all --search "S4 in:body"`): an owner decision
   recorded on an issue is newer than the document and wins over it.

## How to answer

- Quote the requirement and its acceptance criterion verbatim, with its ID,
  its MoSCoW priority and the file and section it came from.
- Name the other requirements, quality requirements and risk measures that
  constrain the same behaviour (S10 and D10 with Q-SEC-2 and Q-SIM-1; S4
  with the upload risk R-06 and the 10-second bar of Q-PERF-2; S12 and S15
  with the server clock of Q-SIM-2 and R-12).
- **Flag, never fill.** Report explicitly when the draft:
  - has no acceptance criterion for the requirement (Should and Could items
    have none);
  - is vague enough that two implementations could both claim to meet it
    ("a clear error message", "immediately");
  - conflicts with another requirement, with an owner decision on an issue,
    or with what the task asks for;
  - says nothing about the behaviour in question;
  - marks the row Dropped: say so with the date and the row that replaces
    it, and never report it as a live requirement;
  - names an open question (`Open: … (O5)`): quote the question and its
    status from the Open questions table, and say that nothing is built on
    it until the owner answers.

  For each, write the question the owner needs to answer, and recommend the
  caller comments it on the issue. Do not propose a number, a rule or a scope
  as if the draft contained it.
- External standards stay authoritative in their own domain regardless of the
  draft: openEHR and HL7 for the integrations (`.claude/rules/integration.md`),
  WCAG 2.1 AA for accessibility, OWASP for security.
