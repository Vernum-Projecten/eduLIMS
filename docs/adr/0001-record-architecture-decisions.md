<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-11-11
- Deciders: maintainer

## Context and problem statement

eduLIMS must stay maintainable by a new maintainer, contributor or AI session
without prior context (driver "long-term continuity" in
[architecture.md](../architecture.md#drivers)). Decisions made outside the
repository are hard to find and easy to lose. The project needs a decision log
in the repository: per choice the options, the trade-off and the decision.

## Considered options

- Architecture decision records in MADR format under `docs/adr/`.
- Decisions only in issues and pull requests.
- Decisions only in an architecture model.

## Decision outcome

Chosen option: **MADR records under `docs/adr/`**. They sit next to the code,
are reviewed in the same pull request as the change they justify, and record
the rejected options, which issues and the model do not do well.

### Consequences

- Good: a reader finds every technology choice with its reasons in one place.
- Good: an AI session reads the same records as context.
- Bad: one more document to keep current; the Definition of Done covers it.
- `docs/architecture.md` still describes the architecture. A decision that
  changes it also updates that document.
