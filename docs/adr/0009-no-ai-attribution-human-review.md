<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0009. No AI attribution; human review of every change

- Status: Accepted
- Date: 2026-11-11
- Deciders: Ruben Talstra (maintainer)

## Context and problem statement

eduLIMS is built with an AI coding assistant (Claude Code), which is the AI
component of the project (PvA 1.6). The principle "AI ondersteunt, mens
beslist" (AI assists, a person decides) from view 0 needs concrete rules: who
is the author of a change, how AI use is disclosed, and who decides what
merges. The advice report names the risks: insecure code, leaked secrets and
personal data in prompts (R-07).

## Considered options

- No AI attribution in commits, pull requests, issues or files; one AI
  statement for the repository; human review of every change.
- Co-author trailers or "generated with" lines on each commit.

## Decision outcome

Chosen option: **no AI attribution anywhere, one disclosure in
[AI_STATEMENT.md](../../AI_STATEMENT.md), and human review**.

- The maintainer is the author of and accountable for every change. No tool is
  named as author or co-author.
- Every change goes through a pull request and the merge queue with green CI.
  The branch rules require no approval. By convention the supervising teacher
  reviews, and every review comment is resolved before merging.
- AI never merges, approves or decides a requirement.
- AI sees code and the pseudonymised test set only (Q-PRIV-3).

### Consequences

- Good: one maintained disclosure instead of a line on every commit.
- Good: accountability stays with a person.
- Bad: without a required approval, review rests on the convention. The
  Definition of Done and GOVERNANCE.md make the convention explicit.
