---
name: run-commands-yourself
description: The owner wants Claude to run every needed local CLI command itself (dev database grants, migrations, env sync, compose) instead of handing them over and waiting
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Run the local commands a change needs yourself, and say what you ran. Don't
hand the owner a `! command` and wait. This covers `pnpm env:sync`,
`pnpm db:migrate`, `pnpm db:reset`, `pnpm dev:db` and `pnpm dev:db:stop`, and a
grant on the dev database through `podman compose -f compose.dev.yaml exec`.

**Why:** owner, 2026-11-11: "you are allowed to run all the cli commands okay
so i can not need to run anything okay and so you are not waiting for me".

**How to apply:**
- After a merge that needs local steps, run them in the main checkout and report
  the result.
- The hard rules still hold:
  - never read or edit the env file itself; `pnpm env:sync` updates it without
    printing values ([[env-file-workflow]]);
  - never delete the postgres volume;
  - no force push to main.
- If the session's permission settings block a command, say so plainly. Don't
  find a way around the block.

Related: [[owner-uses-podman]], [[operators-run-the-image]].
