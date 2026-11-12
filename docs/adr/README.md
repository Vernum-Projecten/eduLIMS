<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Architecture decision records

Each significant architecture or technology decision is recorded here in the
[MADR](https://adr.github.io/madr/) format
([0001](0001-record-architecture-decisions.md)).

| ADR | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-github-instead-of-azure-devops.md) | GitHub instead of Azure DevOps for the development lane | Accepted |
| [0003](0003-tanstack-start-full-ssr-on-vite.md) | TanStack Start with full SSR on Vite | Accepted |
| [0004](0004-typescript-7-native-compiler.md) | TypeScript 7 native compiler | Accepted |
| [0005](0005-better-auth-entra-id.md) | better-auth with Microsoft Entra ID and a PostgreSQL adapter | Accepted |
| [0006](0006-kysely-for-app-data.md) | Kysely for application data | Accepted |
| [0007](0007-node-26-lts-and-pnpm-12.md) | Node.js 26 LTS and pnpm 12 | Accepted |
| [0008](0008-docker-compose-ghcr-slsa.md) | Docker Compose on one VM, images on GHCR, SLSA Build Level 3 | Accepted |
| [0009](0009-no-ai-attribution-human-review.md) | No AI attribution; human review of every change | Accepted |
| [0010](0010-vendor-neutral-oidc-entra-and-keycloak.md) | Vendor-neutral sign-in: Microsoft Entra ID and Keycloak | Superseded by 0015 |
| [0011](0011-english-code-and-i18n.md) | English code and an internationalised UI with Paraglide JS | Proposed |
| [0012](0012-multiple-roles-and-portal-switcher.md) | Multiple roles per user and a portal switcher | Proposed |
| [0013](0013-internal-transport-security.md) | Transport security inside the Compose stack | Proposed |
| [0014](0014-session-lifetimes.md) | Session lifetimes: 8 hours sliding, 24 hours at most | Proposed |
| [0015](0015-runtime-identity-providers.md) | Identity providers at runtime with the better-auth SSO plugin | Proposed |
| [0016](0016-charts-tanstack-charts.md) | Charts: TanStack Charts, through one accessible wrapper | Proposed |
| [0018](0018-classes-as-organizations.md) | A class is a better-auth organization, a lab group a team | Proposed |
| [0017](0017-scim-provisioning.md) | Provisioning users with SCIM 2.0 | Proposed |

## Adding a record

1. Copy the structure of an existing record into `NNNN-short-title.md` with
   the next free number.
2. Set the status to `Proposed`, open a pull request, and set it to
   `Accepted` when it merges.
3. After acceptance, only the status of a record changes. A new decision that
   replaces it gets a new record, and the old record's status becomes
   `Superseded by NNNN`.
4. Add the record to the table above.
