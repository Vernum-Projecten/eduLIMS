---
title: Quick start for developers
description: Run eduLIMS on your own machine with the development database and Keycloak.
sidebar:
  label: Quick start
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

This page runs eduLIMS on your machine for development. PostgreSQL and
Keycloak run in containers (Podman or Docker); eduLIMS runs on the host with `pnpm dev`, so it
reloads on every save. To run eduLIMS on a server, follow
[Install with Docker Compose](/operations/install/) instead.

## Prerequisites

- **Node.js 26 LTS:** the exact version is in
  [`.node-version`](https://github.com/Vernum-Projecten/eduLIMS/blob/main/.node-version).
- **pnpm 12:** the exact version is the `packageManager` field of
  [`package.json`](https://github.com/Vernum-Projecten/eduLIMS/blob/main/package.json).
  `devEngines` enforces both versions, so an install with another Node.js or
  pnpm fails. On macOS: `brew install node pnpm`.
- **A container engine with Compose**, for PostgreSQL 18 and Keycloak:
  Podman with `podman compose`, or Docker with `docker compose`, which takes
  the same arguments. The development database, the tests and the browser
  tests all run on that PostgreSQL 18 server.

## Start the services

[`compose.dev.yaml`](https://github.com/Vernum-Projecten/eduLIMS/blob/main/compose.dev.yaml)
runs PostgreSQL 18 with the eduLIMS database and Keycloak with a ready
`edulims` realm. Both bind to the loopback interface only. Start them and
wait until they are healthy:

```sh
pnpm dev:db
```

`pnpm dev:db` runs `podman compose -f compose.dev.yaml up -d --wait`, or
`docker compose -f compose.dev.yaml up -d --wait` when Podman is not
installed. `pnpm dev:db:stop` stops the stack and keeps its data volume;
`pnpm dev:db:logs` follows its logs.

| Service    | Address                 | Notes                                                                                                                            |
| ---------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | `localhost:5432`        | databases `edulims` (development), `edulims_test` and `edulims_e2e` (tests); change the port with `EDULIMS_DEV_DB_PORT`          |
| Keycloak   | `http://localhost:8180` | admin console `admin` / `admin`; issuer `http://localhost:8180/realms/edulims`; change the port with `EDULIMS_DEV_KEYCLOAK_PORT` |

FerroEHR is an opt-in profile for work on the openEHR integration. It needs
`config/ferroehr.toml`, as in production:

```sh
podman compose -f compose.dev.yaml --profile ferroehr up -d --wait
```

The development credentials are fixed and public. Never point this setup at
real data.

## Configure, migrate and run

`pnpm env:sync` creates your local environment file (`.env`) from the
example file and generates `BETTER_AUTH_SECRET`. The example's development
values, the development login included, match `compose.dev.yaml`. Run it
again after a pull that changes the example: it adds new variables, comments
out obsolete ones and never changes a value you set. Then install, migrate,
seed and start:

```sh
pnpm env:sync
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm dev:setup` runs `pnpm dev:db`, `pnpm db:migrate` and `pnpm db:seed` in
one go. For a clean start before visual work, `pnpm db:reset` empties the
development database, then migrates and seeds it again; it refuses unless
`NODE_ENV` is `development` or `test` and `DATABASE_URL` points at
localhost.

`pnpm dev` serves eduLIMS on `http://localhost:3000`. The
[configuration reference](/operations/configuration/) lists every variable.

## Sign in

Open <http://localhost:3000> and sign in with Keycloak or the development
login. [Demo accounts](/get-started/demo-accounts/) lists the accounts for
every role.

## Before you open a pull request

Run the same gates as CI, with the dev stack running:

```sh
pnpm check       # typecheck, Biome lint, Vitest
pnpm test:e2e    # production build, then Playwright with the axe scan
```

`pnpm test` creates a database of its own next to `edulims_test`, migrates it
once and drops it at the end; every database test runs in a transaction that
is rolled back. `pnpm test:e2e` does the same next to `edulims_e2e`, seeds
it, and serves the app on a free port. Runs in parallel worktrees never share
a database, and neither touches your development data.

[Contributing](/development/contributing/) has the full workflow.
