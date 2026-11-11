---
name: greenfield-until-1-0
description: "eduLIMS is greenfield until its first stable release: no data migrations, backfills or compatibility shims; migrations may be edited, renumbered or squashed; local databases are reset; owner 2026-11-11"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Until the first stable release (1.0) eduLIMS has no production data and no
existing users. Design the schema and the code in their target shape and
rewrite freely:

- no data migrations, backfills, compatibility code, dual configuration or
  "keep existing accounts" paths;
- a migration may be edited, renumbered or merged; anyone with a local
  database runs `pnpm db:reset`;
- at the 1.0 cut the migrations are squashed into one baseline, and from
  then on every schema change is a new, permanent migration with a tested
  down path.

What still matters before 1.0 is a sound **first start**: a fresh install
must be able to get its first identity provider and first administrator
(#46, #48).

**Why:** the owner, 2026-11-11: "it's a greenfield application, so we can
just rewrite everything properly until we release the first stable release".

**How to apply:** when a change would need a migration path or a shim, drop
it and say so in the PR. Parallel branches still number their migrations so
they do not collide, until the squash. See [[stack-decisions]].
