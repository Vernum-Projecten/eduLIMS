<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Pinned version matrix

This file is the single source of truth for every version pin in eduLIMS. If
it disagrees with a configuration file (`package.json`, `.node-version`,
`pnpm-lock.yaml`, a Compose file, a Dockerfile, `CITATION.cff`), that is
drift: fix it, and do not let either side win silently. CI checks that this
file and the configuration files agree ([ci-cd.md](ci-cd.md)).

Every npm dependency is pinned exactly (`save-exact=true` in `.npmrc`), and
`pnpm-lock.yaml` is committed. A version moves in a pull request that updates
this file in the same change.

## Product

| Item | Version | Where |
|---|---|---|
| eduLIMS | 0.0.0 | `package.json` `version`; `CITATION.cff` `version` tracks it |

## Runtime and toolchain

| Item | Pin | Where |
|---|---|---|
| Node.js | 26.13.0 (LTS) | `.node-version`, `package.json` `devEngines.runtime` and `engines.node` (`>=26.13.0 <27`) |
| pnpm | 12.18.0 | `package.json` `packageManager` and `devEngines.packageManager` |
| TypeScript | 7.0.2 (native compiler) | `package.json` |
| Biome | 2.6.6 | `package.json`, `$schema` in `biome.json` |
| `@types/node` | 26.6.6 | `package.json` |

## Application framework

| Package | Pin |
|---|---|
| `@tanstack/react-start` | 1.169.5 |
| `@tanstack/react-router` | 1.170.46 |
| `@tanstack/react-router-ssr-query` | 1.167.3 |
| `@tanstack/react-query` | 5.107.1 |
| `@tanstack/react-form` | 1.33.5 |
| `@tanstack/react-table` | 9.3.1 |
| `react`, `react-dom` | 19.3.1 |
| `@types/react`, `@types/react-dom` | 19.3.0 |
| `vite` | 8.3.7 |
| `@vitejs/plugin-react` | 6.3.0 |
| `nitro` | 3.0.261103-rc |

## UI

| Package | Pin |
|---|---|
| `tailwindcss`, `@tailwindcss/vite` | 4.3.5 |
| `shadcn` (CLI and registry) | 4.23.0 |
| `radix-ui` | 1.8.1 |
| `lucide-react` | 1.71.0 |
| `class-variance-authority` | 0.7.1 |
| `cn` | 0.5.2 |
| `tw-animate-css` | 1.4.0 |
| `@fontsource-variable/geist` | 5.3.0 |

## Sign-in and data

These are added by the foundation milestone. The pins are the current npm
releases on 2026-11-11; `package.json` takes them when the dependency lands.

| Package | Pin |
|---|---|
| `better-auth` | 1.7.20 |
| `kysely` | 0.29.8 |
| `pg` | 8.23.1 |
| `@types/pg` | 8.23.1 |

## Tests

| Package | Pin |
|---|---|
| `vitest`, `@vitest/coverage-v8` | 5.1.0 |
| `jsdom` | 31.0.0 |
| `@testing-library/react` | 16.3.3 |
| `@testing-library/dom` | 10.4.2 |
| `@playwright/test` | 1.65.0 (to be added) |
| `@axe-core/playwright` | 4.14.0 (to be added) |

## Services

| Item | Pin | Where |
|---|---|---|
| PostgreSQL | 18 (image `postgres:18.6`, pinned by digest) | Compose files |
| FerroEHR | the release the research group deploys; openEHR ITS-REST 1.1.0, AQL 1.1 | Compose files |
| FerroBRIDGE | the release the research group deploys; HL7 v2 over MLLP | Compose files |

## Standards

| Standard | Version |
|---|---|
| openEHR REST API | ITS-REST 1.1.0 |
| Archetype Query Language | AQL 1.1 |
| HL7 | v2 (Afinion 2 messages) |
| WCAG | 2.1, level AA |
| ArchiMate model exchange | ArchiMate 3.1 Open Exchange format |
| SLSA | Build Level 3 |
| REUSE | 3.3 |
