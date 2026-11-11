<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0008. Docker Compose on one VM, images on GHCR, SLSA Build Level 3

- Status: Accepted
- Date: 2026-11-11
- Deciders: Ruben Talstra (maintainer)

## Context and problem statement

eduLIMS, FerroEHR, FerroBRIDGE and PostgreSQL 18 run together on a Linux VM
in a Hanze VNET (PvA 4.3). The client has not yet fixed whether hosting stays
on a Hanze VM or moves to Azure. The project must be economical with compute
(Q-SUST-1) and recover within one working day (Q-REL-1).

## Decision drivers

- One environment, no idle services.
- Hosting that can move to Azure later with little work.
- Verifiable images: a deployment runs exactly what CI built.

## Considered options

- Docker Compose on one VM, with images on GHCR and SLSA Build Level 3
  provenance.
- Kubernetes (AKS or k3s).
- Azure App Service with Azure Database for PostgreSQL.

## Decision outcome

Chosen option: **Docker Compose on one Linux VM**. One PostgreSQL 18 server
holds two databases (FerroEHR's and eduLIMS's), each with its own database
user. GitHub Actions builds the eduLIMS image, pushes it to
`ghcr.io/vernum-projecten/edulims` with an SBOM and SLSA Build Level 3
provenance, and the VM pulls a released tag with `docker compose pull`.
`compose.dev.yaml` runs the supporting services for development.

### Consequences

- Good: one host to monitor and one backup routine for both databases.
- Good: the same Compose setup runs locally, on the Hanze VM and on an Azure
  VM.
- Good: `gh attestation verify` proves where an image came from.
- Bad: no automatic failover. Recovery is a restart or a restore from backup,
  within the one-working-day target.
- [ci-cd.md](../ci-cd.md), [release.md](../release.md) and
  [deployment.md](../deployment.md) describe the lane.
