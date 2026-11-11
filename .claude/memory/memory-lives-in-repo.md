---
name: memory-lives-in-repo
description: "Session learnings go in the repository's .claude/memory/ (tracked, shared by every session and contributor), never in a per-user directory; carried from the Ferro family"
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Every memory (an owner decision, a preference, a correction, a reference) is
a file in `.claude/memory/` with a line in `MEMORY.md`, committed and merged
like any other change. The per-user auto-memory directory is not used for
project learnings.

**Why:** the plan of approach requires that a new student or a new AI session
starts with the same framework ("borging in de CollabSpace"). A private note
helps one machine; a tracked file teaches every session and contributor.

**How to apply:** write the file with the front matter and SPDX header the
other files here carry, add its index line to `MEMORY.md`, and land it in the
current branch's PR. `CLAUDE.md` imports the index, so it loads every
session.
