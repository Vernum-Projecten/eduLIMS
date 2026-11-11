<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/edulims-lockup-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/brand/edulims-lockup-light.svg">
  <img src="assets/brand/edulims-lockup-light.svg" alt="eduLIMS" width="290">
</picture>

</div>

# eduLIMS

[![Release](https://img.shields.io/github/v/release/Vernum-Projecten/eduLIMS?sort=semver&logo=github&label=release)](https://github.com/Vernum-Projecten/eduLIMS/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/Vernum-Projecten/eduLIMS/ci.yml?branch=main&logo=githubactions&logoColor=white&label=CI)](https://github.com/Vernum-Projecten/eduLIMS/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/Vernum-Projecten/eduLIMS/codeql.yml?branch=main&logo=github&label=CodeQL)](https://github.com/Vernum-Projecten/eduLIMS/actions/workflows/codeql.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-edulims.eu-blue?logo=astro&logoColor=white)](https://edulims.eu)
[![Docs build](https://img.shields.io/github/actions/workflow/status/Vernum-Projecten/eduLIMS/docs.yml?branch=main&logo=githubactions&logoColor=white&label=docs)](https://github.com/Vernum-Projecten/eduLIMS/actions/workflows/docs.yml)
[![GHCR](https://img.shields.io/badge/ghcr.io-edulims-2496ED?logo=docker&logoColor=white)](https://github.com/Vernum-Projecten/eduLIMS/pkgs/container/edulims)

[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Vernum-Projecten/eduLIMS/badge)](https://scorecard.dev/viewer/?uri=github.com/Vernum-Projecten/eduLIMS)
[![Signed releases](https://img.shields.io/badge/releases-signed-brightgreen?logo=github)](docs/release.md)
[![SLSA Build Level 3](https://slsa.dev/images/gh-badge-level3.svg)](docs/release.md)
[![REUSE](https://img.shields.io/badge/REUSE-compliant-green)](REUSE.toml)
[![WCAG 2.1 AA](https://img.shields.io/badge/WCAG-2.1%20AA-005A9C)](docs/requirements.md)

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

eduLIMS is an open-source laboratory information management system (LIMS) for
practical laboratory education. Students register samples, run measurements on the lab analysers, check their results
and submit a lab report. Teachers set up a practical, grade it with a rubric
and follow their classes on a KPI dashboard. Measurement data is stored as
openEHR compositions in FerroEHR; everything about teaching and grading stays
in the eduLIMS database.

[Architecture](docs/architecture.md) ·
[Requirements](docs/requirements.md) ·
[Test strategy](docs/test-strategy.md) ·
[Decisions](docs/adr/README.md) ·
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

You need Node.js 26 LTS (26.13.0), pnpm 12 (12.18.0) and Docker with Compose.
The versions are enforced through `devEngines` in `package.json`; with
Corepack or `pnpm self-update` you get the pinned pnpm.

```sh
docker compose -f compose.dev.yaml up -d   # PostgreSQL 18 (and FerroEHR when configured)
pnpm install
pnpm db:migrate
pnpm dev                                    # http://localhost:3000
```

Before you open a pull request, run the same gates as CI:

```sh
pnpm check   # typecheck, Biome lint, Vitest
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
