---
title: Configuration reference
description: Every environment variable eduLIMS and its Compose stack read.
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

eduLIMS reads its configuration from the environment and validates all of it
at startup. A missing or invalid value stops the server with one error that
lists every variable at fault. On a Compose host the values live in the
environment file next to `compose.yaml`, readable by root alone; in
development they live in `.env` at the repository root. The example environment file in the
repository lists every name.

## The application

These variables are read by the eduLIMS server
([`src/server/env.ts`](https://github.com/Vernum-Projecten/eduLIMS/blob/main/src/server/env.ts)).
In the production Compose stack, `compose.yaml` sets `NODE_ENV`,
`DATABASE_URL`, `FERROEHR_BASE_URL` and `FERROBRIDGE_BASE_URL` itself, and
passes the rest through from the environment file.

| Variable                  | Required           | Default                                                               | Meaning                                                                                                                                                       |
| ------------------------- | ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | no                 | `production`                                                          | `development`, `test` or `production`. An unset value counts as production, so the development login stays off.                                               |
| `DATABASE_URL`            | yes                |                                                                       | PostgreSQL connection URL (`postgres://` or `postgresql://`) for the eduLIMS database.                                                                        |
| `BETTER_AUTH_SECRET`      | yes                |                                                                       | Secret that signs the session cookies, at least 32 characters. Generate it with `openssl rand -hex 32`.                                                       |
| `BETTER_AUTH_URL`         | yes                |                                                                       | The public URL of eduLIMS, for example `https://lims.example.org`. Must use `https` in production. The redirect URIs of the identity providers start with it. |
| `MICROSOFT_CLIENT_ID`     | with the other two |                                                                       | Application (client) ID of the Entra ID app registration.                                                                                                     |
| `MICROSOFT_CLIENT_SECRET` | with the other two |                                                                       | Client secret of the app registration.                                                                                                                        |
| `MICROSOFT_TENANT_ID`     | with the other two |                                                                       | The directory (tenant) ID. The multi-tenant aliases `common`, `organizations` and `consumers` are refused, so only your own tenant signs in.                  |
| `KEYCLOAK_ISSUER`         | with the other two |                                                                       | Realm issuer URL, `https://<keycloak host>/realms/<realm>`. Plain `http` is accepted only on a loopback host outside production.                              |
| `KEYCLOAK_CLIENT_ID`      | with the other two |                                                                       | Client ID of the confidential client in the realm.                                                                                                            |
| `KEYCLOAK_CLIENT_SECRET`  | with the other two |                                                                       | Client secret of that client.                                                                                                                                 |
| `KEYCLOAK_LABEL` | no | unset | Text of the Keycloak button on the sign-in page, in every language. Unset, the page shows its translated default ("Sign in with Keycloak"). |
| `OIDC_ROLE_CLAIM`         | no                 | `roles` (Entra ID), `realm_access.roles` (Keycloak)                   | Dot path of the ID-token claim that holds the user's roles.                                                                                                   |
| `OIDC_ROLE_MAP`           | no                 | `edulims-student:student,edulims-teacher:teacher,edulims-admin:admin` | Comma-separated `provider role:eduLIMS role` pairs. Every mapped value counts; teacher with admin is allowed, student with another role refuses the sign-in (ADR 0012). |
| `OIDC_DEFAULT_ROLE`       | no                 | unset                                                                 | Role for a user whose token holds no mapped role (`student`, `teacher` or `admin`). Unset means such a user is refused.                                       |
| `FERROEHR_BASE_URL`       | yes                |                                                                       | Base URL of the FerroEHR openEHR REST API.                                                                                                                    |
| `FERROBRIDGE_BASE_URL`    | yes                |                                                                       | Base URL of FerroBRIDGE, for its health check.                                                                                                                |
| `EDULIMS_DEV_LOGIN`       | no                 | `false`                                                               | `true` turns on the email and password login for the seeded development users. Refused when `NODE_ENV=production`.                                            |

An identity provider is on when all three of its variables are set; setting
one or two of them is an error. A production server refuses to start with no
identity provider. [Identity providers](/operations/identity-providers/)
describes the setup on the provider side.

## The Compose stack

These variables are read by `compose.yaml` on a deployment host. A required
variable without a value stops `docker compose` before any container starts.

| Variable                     | Required         | Default     | Meaning                                                                                              |
| ---------------------------- | ---------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `EDULIMS_VERSION`            | yes              |             | The eduLIMS release to run, for example `0.1.0`. It names both the server and the migration image.   |
| `POSTGRES_PASSWORD`          | yes              |             | Password of the PostgreSQL superuser.                                                                |
| `EDULIMS_DB_USER`            | no               | `edulims`   | Database role of eduLIMS.                                                                            |
| `EDULIMS_DB_PASSWORD`        | yes              |             | Password of that role.                                                                               |
| `EDULIMS_DB_NAME`            | no               | `edulims`   | Name of the eduLIMS database.                                                                        |
| `FERROEHR_DB_USER`           | no               | `ferroehr`  | Database role of FerroEHR.                                                                           |
| `FERROEHR_DB_PASSWORD`       | yes              |             | Password of that role.                                                                               |
| `FERROEHR_DB_NAME`           | no               | `ferroehr`  | Name of the FerroEHR database.                                                                       |
| `FERROEHR_LOG_FILTER`        | no               | `info`      | Log filter of FerroEHR.                                                                              |
| `FERROBRIDGE_MLLP_BIND_HOST` | no               | `127.0.0.1` | Host address the MLLP port of FerroBRIDGE binds to.                                                  |
| `FERROBRIDGE_MLLP_PORT`      | no               | `2575`      | Published MLLP port.                                                                                 |
| `FERROBRIDGE_LOG_FILTER`     | no               | `info`      | Log filter of FerroBRIDGE.                                                                           |
| `EDULIMS_BIND_HOST`          | no               | `127.0.0.1` | Host address the eduLIMS port binds to; the reverse proxy forwards to it.                            |
| `EDULIMS_PORT`               | no               | `3000`      | Published eduLIMS port.                                                                              |
| `EDULIMS_BACKUP_DIR`         | no               | `./backups` | Host directory mounted into PostgreSQL at `/backup` for the dumps ([Backups](/operations/backups/)). |
| `KEYCLOAK_DB_USER`           | no               | `keycloak`  | Database role of Keycloak (profile `keycloak`).                                                      |
| `KEYCLOAK_DB_PASSWORD`       | with the profile |             | Password of that role. When it is set, the first start also creates the Keycloak database.           |
| `KEYCLOAK_DB_NAME`           | no               | `keycloak`  | Name of the Keycloak database.                                                                       |
| `KEYCLOAK_HOSTNAME`          | with the profile |             | Public hostname of Keycloak.                                                                         |
| `KEYCLOAK_ADMIN_USER`        | first start      |             | User name of the first Keycloak administrator. Remove it after the first start.                      |
| `KEYCLOAK_ADMIN_PASSWORD`    | first start      |             | Password of that administrator. Change it in the admin console and remove it after the first start.  |
| `KEYCLOAK_BIND_HOST`         | no               | `127.0.0.1` | Host address the Keycloak port binds to.                                                             |
| `KEYCLOAK_PORT`              | no               | `8180`      | Published Keycloak port.                                                                             |

## Development only

`compose.dev.yaml` reads these on a developer machine.

| Variable                    | Default | Meaning                                     |
| --------------------------- | ------- | ------------------------------------------- |
| `EDULIMS_DEV_DB_PORT`       | `5432`  | Host port of the development PostgreSQL.    |
| `EDULIMS_DEV_KEYCLOAK_PORT` | `8180`  | Host port of the development Keycloak.      |
| `EDULIMS_DEV_FERROEHR_PORT` | `8080`  | Host port of FerroEHR (profile `ferroehr`). |

The test commands read these from the shell, not from `.env`:

| Variable                   | Default                                                  | Meaning                                                            |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| `TEST_DATABASE_URL`        | `postgres://edulims:edulims@127.0.0.1:5432/edulims_test` | Base of `pnpm test`: each run creates `<name>_<run id>` beside it, so its name must end in `_test` and its user needs `CREATEDB`. |
| `E2E_DATABASE_URL`         | `postgres://edulims:edulims@127.0.0.1:5432/edulims_e2e`  | Base of `pnpm test:e2e`: each run creates, seeds and drops `<name>_<run id>` beside it; its user needs `CREATEDB`. |
| `EDULIMS_CONTAINER_ENGINE` | `podman` when installed, else `docker`                   | Container engine of `pnpm dev:db`, `dev:db:stop` and `dev:db:logs`. |

## Secrets

Generate every secret and database password with `openssl rand -hex 32`. Hex
keeps the database URLs valid without escaping. Never commit the environment
file; the repository ignores it.
