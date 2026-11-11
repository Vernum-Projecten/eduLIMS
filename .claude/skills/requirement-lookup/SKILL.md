---
name: requirement-lookup
description: Finds a requirement (S1 to S9, D1 to D8, B1 to B4, a quality requirement, a KPI or a risk measure) and its current draft acceptance criterion in docs/requirements.md, quotes it with its MoSCoW priority, and flags where it is unclear, missing or in conflict with the task. Use before implementing, testing or reviewing behaviour a requirement covers, or when an issue cites a requirement ID.
allowed-tools: Read, Grep, Glob
argument-hint: "<requirement ID or topic, e.g. S4, D3, KPI, WCAG>"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /requirement-lookup

Answer "what does the requirement say" from the text in the repository, never
from memory. **The requirements are a working draft**, still under
discussion with the product owner: the IDs, the MoSCoW priorities, the
acceptance criteria, the KPIs and their norms can all change. This skill
reports what the draft says today and where it falls short; it never settles
a question the draft leaves open.

## Where to look

1. `docs/requirements.md`: the requirement tables (Studentportaal S1 to S9,
   Docentportaal D1 to D8, Beheer B1 to B4), the acceptance criteria of the
   Must requirements, the quality requirements (ISO 25010), the risk table
   with its measures, and the KPI table with its norms. Search it with Grep
   for the ID (`\bS4\b`) and for the Dutch topic words (`wellpositie`,
   `deadline`, `rubric`, `gemiddelde`).
2. `docs/architecture.md` for where a requirement lands in the design
   (portals, databases, the openEHR template, the integrations).
3. The closed and open issues that cite the ID
   (`gh issue list --state all --search "S4 in:body"`): an owner decision
   recorded on an issue is newer than the document and wins over it.

## How to answer

- Quote the requirement and its acceptance criterion verbatim, in Dutch, with
  its ID, its MoSCoW priority and the file and section it came from. Add an
  English one-line paraphrase.
- Name the other requirements, quality requirements and risk measures that
  constrain the same behaviour (S7 and D3 with the "eigen gegevens" risk
  measure; S4 with the upload risk and the 10-second performance bar; D5 with
  the "gemiddelde vanaf 5 beoordelingen" measure).
- **Flag, never fill.** Report explicitly when the draft:
  - has no acceptance criterion for the requirement (Should and Could items
    have none);
  - is vague enough that two implementations could both claim to meet it
    ("duidelijke foutmelding", "direct");
  - conflicts with another requirement, with an owner decision on an issue,
    or with what the task asks for;
  - says nothing about the behaviour in question.

  For each, write the question the owner needs to answer, and recommend the
  caller comments it on the issue. Do not propose a number, a rule or a scope
  as if the draft contained it.
- External standards stay authoritative in their own domain regardless of the
  draft: openEHR and HL7 for the integrations (`.claude/rules/integration.md`),
  WCAG 2.1 AA for accessibility, OWASP for security.
