<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0002. GitHub instead of Azure DevOps for the development lane

- Status: Accepted
- Date: 2026-11-11
- Deciders: Ruben Talstra (maintainer); the product owner is informed in the
  sprint review

## Context and problem statement

The development lane holds the backlog, the repository, CI/CD and the
container registry. Views 0 to 7 of the ArchiMate model (2026-09-29) used
GitHub, GitHub Actions and GHCR. The Plan van Aanpak (sections 1.6, 2.3, 4.1,
6.1 and 7.2) and view 8 then chose the Azure DevOps environment of the
research group's CollabSpace: Azure Boards, Azure Repos, Azure Pipelines and
Azure Container Registry. Implementation starts now, and the lane is set up
once.

Sign-in is a separate question. Early views used SURFconext; the PvA chose
Microsoft Entra ID (OIDC with PKCE). That choice stands
([0005](0005-better-auth-entra-id.md)).

## Decision drivers

- Continuity: a new developer or AI session finds code, rules, backlog and
  pipeline in one place (PvA 2.3).
- Supply chain: signed releases with SLSA Build Level 3 provenance
  ([0008](0008-docker-compose-ghcr-slsa.md)).
- Effort: one developer, one semester.
- Openness: the code is public under Apache-2.0.

## Considered options

- GitHub: Issues, Projects, Actions and GHCR, in the organization
  `Vernum-Projecten`.
- Azure DevOps of the CollabSpace: Boards, Repos, Pipelines and ACR.

## Decision outcome

Chosen option: **GitHub**. The repository is `Vernum-Projecten/eduLIMS`. The
backlog is GitHub Issues with milestones and a GitHub Project. CI/CD is GitHub
Actions. Images go to GHCR.

### Consequences

- Good: GitHub Actions produces SLSA Build Level 3 provenance and artifact
  attestations without extra tooling.
- Good: private vulnerability reporting, the merge queue and branch rules are
  built in.
- Good: future students can work on the public repository without an Azure
  DevOps licence.
- Bad: the CollabSpace standard is Azure DevOps. The handover document points
  the research group to GitHub.
- Neutral: sign-in stays Microsoft Entra ID; nothing in the application
  depends on the lane.
- Follow-up: the ArchiMate model (view 8) and the PvA interface table are
  updated to GitHub (backlog task `task-archimate-update`).

## Pros and cons of the options

### GitHub

- Good: one place for code, issues, review, CI and registry.
- Good: OIDC-based publishing and attestations, no long-lived registry token.
- Bad: differs from the PvA and the CollabSpace standard.

### Azure DevOps

- Good: matches the PvA and the research group's environment.
- Bad: provenance and attestations need extra work, and the project depends on
  licences and access granted through the CollabSpace.
