<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0002. GitHub instead of Azure DevOps for the development lane

- Status: Accepted
- Date: 2026-11-11
- Deciders: maintainer; the product owner is informed in the
  milestone review

## Context and problem statement

The development lane holds the issue tracker, the repository, CI/CD and the
container registry. Two platforms were candidates: GitHub (Issues, Projects,
Actions and GHCR) and Azure DevOps (Azure Boards, Azure Repos, Azure Pipelines
and Azure Container Registry), which institutions often provide. The lane is
set up once, before implementation starts.

Sign-in is a separate question, settled in
[0005](0005-better-auth-entra-id.md) and
[0010](0010-vendor-neutral-oidc-entra-and-keycloak.md).

## Decision drivers

- Continuity: a new developer or AI session finds code, rules, issues and
  pipeline in one place.
- Supply chain: signed releases with SLSA Build Level 3 provenance
  ([0008](0008-docker-compose-ghcr-slsa.md)).
- Effort: a small team with one maintainer.
- Openness: the code is public under Apache-2.0.

## Considered options

- GitHub: Issues, Projects, Actions and GHCR, in the organization
  `Vernum-Projecten`.
- Azure DevOps: Boards, Repos, Pipelines and ACR.

## Decision outcome

Chosen option: **GitHub**. The repository is `Vernum-Projecten/eduLIMS`. The
work is planned in GitHub Issues with milestones and a GitHub Project. CI/CD is GitHub
Actions. Images go to GHCR.

### Consequences

- Good: GitHub Actions produces SLSA Build Level 3 provenance and artifact
  attestations without extra tooling.
- Good: private vulnerability reporting, the merge queue and branch rules are
  built in.
- Good: contributors can work on the public repository without an Azure
  DevOps licence.
- Bad: an institution that standardises on Azure DevOps has to work with
  GitHub for this project.
- Neutral: sign-in is independent of the lane; nothing in the application
  depends on it.

## Pros and cons of the options

### GitHub

- Good: one place for code, issues, review, CI and registry.
- Good: OIDC-based publishing and attestations, no long-lived registry token.
- Bad: differs from what some institutions provide by default.

### Azure DevOps

- Good: matches the environment some institutions provide.
- Bad: provenance and attestations need extra work, and the project depends on
  licences and access granted by an institution.
