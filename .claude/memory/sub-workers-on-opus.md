---
name: sub-workers-on-opus
description: "The orchestrating session may run on the most capable model; every sub-worker it spawns runs on Opus, set explicitly on the spawn; owner 2026-11-19"
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The session that orchestrates the work may run on the most capable model.
Every sub-worker it spawns runs on Opus.

**Why:** the owner, 2026-11-19: the most capable model was chosen for the
content and the decisions of the orchestrator; the workers do bounded work
and do not need it.

**How to apply:**

- The project agents (`implementer`, `ui-implementer`, `test-writer`, the
  reviewers, `requirements-researcher`) are defined on Opus; prefer them.
- A general-purpose or search agent inherits the session's model unless the
  spawn says otherwise, so pass the Opus model on every such spawn.
- Keep the judgement with the orchestrator: requirements, design decisions
  and anything a draft requirement leaves open are never delegated.
