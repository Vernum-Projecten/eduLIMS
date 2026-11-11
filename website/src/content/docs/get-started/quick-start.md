---
title: Quick start for developers
description: Run eduLIMS on your own machine with the development database and Keycloak.
sidebar:
  label: Quick start
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

This page runs eduLIMS on your machine for development. PostgreSQL and
Keycloak run in Docker; eduLIMS runs on the host with `pnpm dev`, so it
reloads on every save. To run eduLIMS on a server, follow
[Install with Docker Compose](/operations/install/) instead.

## Prerequisites

- **Node.js 26 LTS:** the exact version is in
  [`.node-version`](https://github.com/Vernum-Projecten/eduLIMS/blob/main/.node-version).
- **pnpm 12:** the exact version is the `packageManager` field of
  [`package.json`](https://github.com/Vernum-Projecten/eduLIMS/blob/main/package.json).
  `devEngines` enforces both versions, so an install with another Node.js or
  pnpm fails. On macOS: `brew install node pnpm`.
- **Docker** with the Compose plugin, for PostgreSQL and Keycloak. Without
  Docker you can use the embedded database instead (below).

## Start the services

[`compose.dev.yaml`](https://github.com/Vernum-Projecten/eduLIMS/blob/main/compose.dev.yaml)
runs PostgreSQL 18 with the eduLIMS database and Keycloak with a ready
`edulims` realm. Both bind to the loopback interface only.

```sh
docker compose -f compose.dev.yaml up -d --wait
```

| Service    | Address                 | Notes                                                                                                                            |
| ---------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | `localhost:5432`        | change the port with `EDULIMS_DEV_DB_PORT`                                                                                       |
| Keycloak   | `http://localhost:8180` | admin console `admin` / `admin`; issuer `http://localhost:8180/realms/edulims`; change the port with `EDULIMS_DEV_KEYCLOAK_PORT` |

FerroEHR is an opt-in profile for work on the openEHR integration. It needs
`config/ferroehr.toml`, as in production:

```sh
docker compose -f compose.dev.yaml --profile ferroehr up -d --wait
```

The development credentials are fixed and public. Never point this setup at
real data.

### Without Docker

`pnpm dev:db` runs an embedded PostgreSQL ([PGlite](https://pglite.dev)) on
`localhost:5432`, with its data in `.data/` (git-ignored). Keep it running in
its own terminal. There is no Keycloak then, so sign in with the development
login and comment out the `KEYCLOAK_*` lines in `.env`.

```sh
pnpm dev:db
```

## Configure, migrate and run

Copy the example environment file to `.env` and set `BETTER_AUTH_SECRET`
(`openssl rand -hex 32`) and `EDULIMS_DEV_LOGIN=true`. Its other development
values match `compose.dev.yaml`. Then install, migrate, seed and start:

```sh
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm dev` serves eduLIMS on `http://localhost:3000`. The
[configuration reference](/operations/configuration/) lists every variable.

## Sign in

You have two ways to sign in during development.

**The development login.** With `EDULIMS_DEV_LOGIN=true`, `pnpm db:seed`
creates one user per role, each with the password `eduLIMS-dev-only`. The
seed refuses to run without that flag, and the server refuses the flag when
`NODE_ENV=production`.

| Email                  | Role      |
| ---------------------- | --------- |
| `student@example.test` | `student` |
| `teacher@example.test` | `teacher` |
| `admin@example.test`   | `admin`   |

**Keycloak.** The development realm has one user per role (`student`,
`teacher` and `admin`), each with its name as password, and the role mapper
eduLIMS reads ([Identity providers](/operations/identity-providers/)).

## Before you open a pull request

Run the same gates as CI:

```sh
pnpm check       # typecheck, Biome lint, Vitest
pnpm test:e2e    # production build, then Playwright with the axe scan
```

[Contributing](/development/contributing/) has the full workflow.
