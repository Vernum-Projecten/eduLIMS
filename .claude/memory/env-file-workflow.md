---
name: env-file-workflow
description: "The owner wants their local env file kept current, but a session never reads or edits it: update the example file and end the report with 'run ! pnpm env:sync'; work in a separate worktree while the owner runs pnpm dev"
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The owner asked (2026-11-11) "please also always update my .env". A session
cannot and must not: the deny rules in `.claude/settings.json` and the
`env_guard` hook keep the local env file out of every session so secrets
never enter one. `pnpm env:sync` (`scripts/dev/env-sync.sh`) does the update
on the owner's machine: it adds missing variables from the example, comments
out obsolete ones, generates an empty `BETTER_AUTH_SECRET`, never changes a
set value and prints names only.

**Why:** honours the request while keeping secrets out of the session.

**How to apply:**

- A change that adds, renames or retires a variable edits the example env
  file (and the `OBSOLETE` list in `env-sync.sh` for a retired one), and the
  report ends with "run `! pnpm env:sync`".
- Never put the literal env file name in a Bash command (the hook matches the
  text); use the Edit or Write tools and commit messages from a file.
- `NODE_ENV` never goes into the env file: Vite reads it and `pnpm build`
  then ships a broken production bundle (#19).
- When the owner runs `pnpm dev` on `main`, do work in a separate git
  worktree so their running server is not disturbed.
