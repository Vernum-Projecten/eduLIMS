<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/edulims-lockup-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/brand/edulims-lockup-light.svg">
  <img src="assets/brand/edulims-lockup-light.svg" alt="eduLIMS" width="290">
</picture>

**The open-source laboratory information management system for practical laboratory education.**

[Documentation](https://edulims.eu) ·
[Quick start](#quick-start) ·
[Architecture](docs/architecture.md) ·
[Decisions](docs/adr/README.md) ·
[Citing eduLIMS](#citation)

**Project**<br>
[![Release](https://img.shields.io/github/v/release/Vernum-Projecten/eduLIMS?sort=semver&logo=github&label=release)](https://github.com/Vernum-Projecten/eduLIMS/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/Vernum-Projecten/eduLIMS/ci.yml?branch=main&logo=githubactions&logoColor=white&label=CI)](https://github.com/Vernum-Projecten/eduLIMS/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/Vernum-Projecten/eduLIMS/codeql.yml?branch=main&logo=github&label=CodeQL)](https://github.com/Vernum-Projecten/eduLIMS/actions/workflows/codeql.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-edulims.eu-blue?logo=astro&logoColor=white)](https://edulims.eu)
[![Docs build](https://img.shields.io/github/actions/workflow/status/Vernum-Projecten/eduLIMS/docs.yml?branch=main&logo=githubactions&logoColor=white&label=docs)](https://github.com/Vernum-Projecten/eduLIMS/actions/workflows/docs.yml)
[![GHCR](https://img.shields.io/badge/ghcr.io-edulims-2496ED?logo=docker&logoColor=white)](https://github.com/Vernum-Projecten/eduLIMS/pkgs/container/edulims)

**Quality and security**<br>
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Vernum-Projecten/eduLIMS/badge)](https://scorecard.dev/viewer/?uri=github.com/Vernum-Projecten/eduLIMS)
[![Signed releases](https://img.shields.io/badge/releases-signed-brightgreen?logo=github)](docs/release.md)
[![SLSA Build Level 3](https://slsa.dev/images/gh-badge-level3.svg)](docs/release.md)
[![REUSE](https://img.shields.io/badge/REUSE-compliant-green)](REUSE.toml)
[![WCAG 2.1 AA](https://img.shields.io/badge/WCAG-2.1%20AA-005A9C)](docs/requirements.md)

**Stack**<br>
[![Node.js 26 LTS](https://img.shields.io/badge/Node.js-26%20LTS-5FA04E?logo=nodedotjs&logoColor=white)](.node-version)
[![pnpm 12](https://img.shields.io/badge/pnpm-12-F69220?logo=pnpm&logoColor=white)](package.json)
[![TypeScript 7](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![TanStack Start](https://img.shields.io/badge/TanStack-Start-FF4154?logo=reactquery&logoColor=white)](https://tanstack.com/start/latest)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Vite 8](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](vite.config.ts)
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-radix--nova-000000?logo=shadcnui&logoColor=white)](components.json)
[![Better Auth](https://img.shields.io/badge/auth-Better%20Auth-000000)](https://better-auth.com)
[![PostgreSQL 18](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)](compose.yaml)
[![openEHR](https://img.shields.io/badge/openEHR-FerroEHR-0E7C86)](docs/architecture.md)
[![Biome](https://img.shields.io/badge/lint-Biome-60A5FA?logo=biome&logoColor=white)](biome.json)

</div>

eduLIMS is an open-source laboratory information management system (LIMS) for
practical laboratory education. Students register samples, run measurements on the lab analysers, check their results
and submit a lab report. Teachers set up a practical, grade it with a rubric
and follow their classes on a KPI dashboard. Measurement data is stored as
openEHR compositions in FerroEHR; everything about teaching and grading stays
in the eduLIMS database.

[Requirements](docs/requirements.md) ·
[Test strategy](docs/test-strategy.md) ·
[Versions](docs/VERSIONS.md)

## Why it exists

Today students hand in their measurements as Excel files and photos, and a
teacher opens, checks and grades each file by hand. That costs teachers a lot
of time, and it is not how a real laboratory works: there, a measurement lands
in a LIMS on its own. eduLIMS closes that gap:

- The Abbott Afinion 2 sends HbA1c and CRP results over HL7 v2 to
  FerroBRIDGE, which writes them to FerroEHR. Nobody retypes a value.
- The BioTek Epoch 2 plate readers export from Gen5 to Excel; the student
  uploads the file and eduLIMS validates every sample ID and well position
  before it writes the results to FerroEHR.
- Every measurement is traceable through its sample ID to the device, the
  sample and the student.

## Status

Implementation started on 2026-11-11. The design (requirements, architecture,
test strategy, KPI dashboard) is recorded under [`docs/`](docs/); the
requirements are a working draft under re-evaluation. The first milestone, `v0.1.0 – Foundation`,
sets up the application shell, sign-in, the database and the CI/CD lane.
The work is planned in [GitHub milestones](https://github.com/Vernum-Projecten/eduLIMS/milestones)
and [issues](https://github.com/Vernum-Projecten/eduLIMS/issues).

eduLIMS only ever holds test data from volunteer subjects under a pseudonym. It
is not meant for patient data.

## Quick start

You need Node.js 26 LTS (26.13.0) and pnpm 12 (12.18.0), enforced through
`devEngines` in `package.json` (on macOS: `brew install node pnpm`), and
Podman or Docker with Compose for PostgreSQL 18 and Keycloak.

```sh
pnpm install
pnpm env:sync               # creates or updates your local env file from the example, with a fresh secret
pnpm dev:db                 # PostgreSQL 18 and Keycloak from compose.dev.yaml, waits until healthy
pnpm db:migrate
pnpm db:seed                # student@, teacher@ and admin@example.test, password eduLIMS-dev-only
pnpm dev                    # http://localhost:3000
```

`pnpm dev:db` runs `podman compose -f compose.dev.yaml up -d --wait`, or the
same `docker compose` command when Podman is not installed. `pnpm dev:db:stop`
stops the stack and keeps its data, `pnpm dev:db:logs` follows its logs,
`pnpm dev:setup` runs `dev:db`, `db:migrate` and `db:seed` in one go, and
`pnpm db:reset` empties the local development database, then migrates and
seeds it again. Run `pnpm env:sync` again after a pull that changes the
example env file: it adds new variables, comments out obsolete ones and never
changes a value you set, printing variable names only.

### Demo accounts

Open <http://localhost:3000> and sign in with one of these development
accounts. Their passwords are public: they exist only on a development
machine.

| Role          | Keycloak (username / password) | Development login (email / password)     |
| ------------- | ------------------------------ | ---------------------------------------- |
| Student       | `student` / `student`          | `student@example.test` / `eduLIMS-dev-only` |
| Teacher       | `teacher` / `teacher`          | `teacher@example.test` / `eduLIMS-dev-only` |
| Administrator | `admin` / `admin`              | `admin@example.test` / `eduLIMS-dev-only`   |
| Teacher and Administrator | `coordinator` / `coordinator` | `teacher-admin@example.test` / `eduLIMS-dev-only` |

A user with two roles switches between the Teacher portal and the Admin
portal with the portal switcher at the top of the sidebar. The Keycloak
realm has more users that test how roles arrive (directly, through groups,
both, a conflicting set and no role); the docs page below lists them. The
realm is imported only when the Keycloak container is created, so after a
change to it run `pnpm dev:db:stop && pnpm dev:db`.

The Keycloak admin console at <http://localhost:8180> is a separate account
in the `master` realm (`admin` / `admin`); it manages Keycloak and does not
sign in to eduLIMS. [Demo accounts](https://edulims.eu/get-started/demo-accounts/)
on the docs site has the details.

Before you open a pull request, run the same gates as CI. The tests need the
dev stack running: `pnpm test` uses its `edulims_test` database and
`pnpm test:e2e` its `edulims_e2e` database, never your development data.

```sh
pnpm check      # typecheck, Biome lint, Vitest
pnpm test:e2e   # production build, then Playwright with the axe scan
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the full workflow.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 26 LTS, pnpm 12 |
| Application | TanStack Start (full SSR) on Vite 8 with a Nitro Node server, React 19 |
| Routing, data, forms, tables | TanStack Router, Query, Form and Table |
| UI | Tailwind CSS 4, shadcn/ui on Radix |
| Language | TypeScript 7 (native compiler) |
| Lint and format | Biome |
| Tests | Vitest, Playwright with axe for accessibility |
| Sign-in | better-auth with Microsoft Entra ID and/or Keycloak (OpenID Connect, PKCE) |
| Database | PostgreSQL 18 through Kysely and `pg` |
| Measurement data | FerroEHR (openEHR REST and AQL), FerroBRIDGE (HL7 v2 over MLLP) |
| Delivery | Docker Compose on one Linux VM, images on GHCR, SLSA Build Level 3 releases |

The exact versions are in [docs/VERSIONS.md](docs/VERSIONS.md). The reasons
behind each choice are in the [decision records](docs/adr/README.md).

## Documentation

The documentation site, with its landing page, is <https://edulims.eu>.
The sources in this repository:

- [Architecture](docs/architecture.md): principles, integrations, data split,
  portals and roles, deployment, and quality requirements.
- [Requirements](docs/requirements.md) (working draft, still under discussion): functional requirements S1 to S9, D1
  to D8 and B1 to B4, the quality requirements, risks and KPIs, each with a
  stable ID.
- [Test strategy](docs/test-strategy.md) and the Definition of Done.
- [KPI dashboard](docs/kpi-dashboard.md): KPIs, norms, data sources and the
  two design iterations.
- [Decision records](docs/adr/README.md).
- [AI statement](AI_STATEMENT.md): how AI tools are used to build eduLIMS.
- [Governance](GOVERNANCE.md), [Maintainers](MAINTAINERS.md),
  [Support](SUPPORT.md), [Security](SECURITY.md),
  [Code of conduct](CODE_OF_CONDUCT.md).

## Citation

If you use eduLIMS in research or teaching material, please cite it. The
metadata is in [`CITATION.cff`](CITATION.cff): GitHub's "Cite this
repository" button in the sidebar gives APA and BibTeX for the current
release, and every release is archived on Zenodo with its own DOI. In BibTeX,
with `X.Y.Z` replaced by the version you used:

```bibtex
@software{Talstra_eduLIMS,
  author = {Talstra, Ruben},
  license = {Apache-2.0},
  title = {{eduLIMS}},
  url = {https://github.com/Vernum-Projecten/eduLIMS},
  version = {X.Y.Z}
}
```

## Licence

Copyright Ruben Talstra. Licensed under the Apache License, Version 2.0; see
[LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party material is listed in
[REUSE.toml](REUSE.toml).
