---
name: operators-run-the-image
description: Operators run eduLIMS only from the OCI images with Docker Compose; no Node, pnpm or source tree on the host, so every operator command runs through an image
metadata:
  type: feedback
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

An operator has the GHCR images and `compose.yaml`, nothing else: no Node.js,
no pnpm, no checkout. Every operator task must work from the images.

**Why:** owner, 2026-11-11: "they just want to run the image and done with the
whole docker compose". The runtime and tools images are distroless, with no
shell and no pnpm inside.

**How to apply:**
- An operator command (migrate, grant the admin role, add an identity
  provider, prune) is a subcommand of the CLI in the tools image, run as
  `docker compose run --rm edulims-tools <subcommand>`; `edulims-migrate` is
  the one-shot migration service that runs at start-up. The `pnpm …`
  scripts call the same entry point and are for developers only.
- Anything that has to happen regularly (retention pruning) runs on its own
  inside the app container, not from a host cron job.
- Operator docs (`docs/deployment.md`, the operator guides) show only
  `docker compose …` commands; pnpm appears only in developer docs.
- A new setting reaches the container through `compose.yaml` as well as the
  example env file.

Related: [[owner-uses-podman]], [[env-file-workflow]].
