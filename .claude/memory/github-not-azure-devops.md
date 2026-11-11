---
name: github-not-azure-devops
description: "The development line is GitHub (Issues, Actions, GHCR, org Vernum-Projecten); Azure DevOps (Boards, Repos, Pipelines, Container Registry) is not used; owner decision at the bootstrap, 2026-11"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Azure DevOps (Boards, Repos, Pipelines, Container Registry) was an option for
the development line. The owner decided GitHub instead, the model the Ferro
family runs on ([ADR 0002](../../docs/adr/0002-github-instead-of-azure-devops.md)).

**Why:** owner decision at the bootstrap of the repository (November 2026),
carried in the bootstrap brief.

**How to apply:**

- Tracker: GitHub Issues on `Vernum-Projecten/eduLIMS` with the native issue
  types `Task`, `Bug`, `Feature` (`.claude/rules/issue-workflow.md`).
- CI/CD: GitHub Actions; images on `ghcr.io/vernum-projecten/edulims`;
  deployment with Docker Compose (`.claude/rules/ci-cd.md`).
- Never add Azure DevOps configuration.
- Hosting (an institution's Linux VM or one Azure environment) is a separate, still
  open question for the product owner; this decision is about the
  development line only.
