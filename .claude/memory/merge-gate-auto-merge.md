---
name: merge-gate-auto-merge
description: "main merges only through a PR in the merge queue with the required `conclusion` check and 0 required approvals; arm auto-merge with `gh pr merge <n> --auto` the moment a PR opens; never --admin; owner decision at the bootstrap"
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The `main` ruleset requires a pull request, the merge queue, and one status
check named `conclusion` (the summary job of `ci.yml`). It requires zero
approvals. Auto-merge is the hand-off: the PR merges when the queue's checks
pass.

**Why:** owner decision at the bootstrap, the same gate the Ferro family
runs. The test strategy's review by the supervising teacher is part of the
Definition of Done (a process step), not a branch rule.

**How to apply:**

- Open the PR, then arm it as its own command: `gh pr merge <n> --auto`.
  `.claude/settings.json` allows exactly that and denies `--admin`, `-R` and
  `--repo`.
- The merge queue sets the merge method; do not pass `--squash` or
  `--delete-branch`.
- Do not push follow-up commits to an armed PR unless it is blocked; open a
  new PR instead.
- After a merge: `git fetch --prune`, delete local branches whose upstream is
  gone, branch new work from `origin/HEAD`.
