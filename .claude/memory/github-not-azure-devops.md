---
name: github-not-azure-devops
description: "The development line is GitHub (Issues, Actions, GHCR, org Vernum-Projecten); the Azure DevOps setup the plan of approach describes (Boards, Repos, Pipelines, Container Registry) is not used; owner decision at the bootstrap, 2026-11"
metadata:
  type: project
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

The plan of approach and the requirements analysis say the backlog lives in
Azure Boards, the code in Azure Repos, the pipeline in Azure Pipelines and
the images in Azure Container Registry. The owner decided GitHub instead, the
model the Ferro family runs on. The architecture model's view 7 already
shows GitHub, GitHub Actions and GHCR.

**Why:** owner decision at the bootstrap of the repository (November 2026),
carried in the bootstrap brief.

**How to apply:**

- Tracker: GitHub Issues on `Vernum-Projecten/eduLIMS` with the native issue
  types `Task`, `Bug`, `Feature` (`.claude/rules/issue-workflow.md`).
- CI/CD: GitHub Actions; images on `ghcr.io/vernum-projecten/edulims`;
  deployment with Docker Compose (`.claude/rules/ci-cd.md`).
- When a source document says Azure DevOps, read it as the GitHub
  equivalent; never add Azure DevOps configuration.
- Hosting (a Hanze Linux VM or one Azure environment) is a separate, still
  open question for the product owner; this decision is about the
  development line only.
