<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-11-11
- Deciders: Ruben Talstra (maintainer)

## Context and problem statement

eduLIMS must stay maintainable after the student project ends, by a new
student or a new AI session (driver "long-term continuity" in
[architecture.md](../architecture.md#drivers)). The decisions so far live in
Dutch coursework documents and in the decision table of the ArchiMate model.
The reflection on the advice work also asked for a decision log in the
repository: per choice the options, the trade-off and the decision.

## Considered options

- Architecture decision records in MADR format under `docs/adr/`.
- Decisions only in issues and pull requests.
- Decisions only in the ArchiMate model ("Genomen besluiten").

## Decision outcome

Chosen option: **MADR records under `docs/adr/`**. They sit next to the code,
are reviewed in the same pull request as the change they justify, and record
the rejected options, which issues and the model do not do well.

### Consequences

- Good: a reader finds every technology choice with its reasons in one place.
- Good: an AI session reads the same records as context.
- Bad: one more document to keep current; the Definition of Done covers it.
- The ArchiMate model still records the architecture. A decision that changes
  a view also updates the model.
