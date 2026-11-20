---
name: owner-uses-podman
description: "The owner runs containers locally with Podman (podman compose through docker-compose v5), not Docker; every image reference is fully qualified"
metadata:
  type: user
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The owner's machine runs Podman 6 with a podman machine; `podman compose`
uses docker-compose v5 as its provider, so `--wait` and profiles work.
`pnpm dev:db` (`scripts/dev/compose.sh`) picks Podman first and Docker as the
fallback.

**Why:** the owner, 2026-11-11: "we use podman locally".

**How to apply:** write commands as `podman compose …` with `docker compose`
as the equivalent; pin every image fully qualified (`docker.io/library/…`,
`quay.io/…`, `ghcr.io/…`), since Podman does not resolve short names the way
Docker does. Never stop or recreate the owner's running containers without
asking, and never start the owner's stack (`pnpm dev:db`) either when it is
down: the owner may have stopped it on purpose to rebuild it (2026-11-20). A
worker that needs a stack runs its own under its own project name
(`podman compose -p <own-name> …`), because `compose.dev.yaml` names its
project `edulims-dev`, so a bare `podman compose -f compose.dev.yaml down`
from any checkout acts on the owner's stack. At cleanup, remove only the
containers and volumes your own workers created (named after the worker,
such as `edulims-agent<n>-pg`); other containers on the machine, such as
`ferroehr-testkit-pg18`, belong to other sessions and are never touched
(2026-11-20).
