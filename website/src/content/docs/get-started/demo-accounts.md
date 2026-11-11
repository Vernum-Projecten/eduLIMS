---
title: Demo accounts
description: The accounts to sign in with on a development machine, one per role, for Keycloak and for the development login.
sidebar:
  label: Demo accounts
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

These accounts exist only on a development machine. Their passwords are
public: never create them on a server that holds real data. Start the stack
first ([Quick start](/get-started/quick-start/)).

## Sign in through Keycloak

`pnpm dev:db` starts Keycloak with the `edulims` realm from
`docker/keycloak/edulims-realm.json`. On the eduLIMS sign-in page choose
**Sign in with Keycloak**, then use one of these:

| Role          | Username  | Password  | Lands on  |
| ------------- | --------- | --------- | --------- |
| Student       | `student` | `student` | `/student` |
| Teacher       | `teacher` | `teacher` | `/teacher` |
| Administrator | `admin`   | `admin`   | `/admin`   |

Each user carries the realm role (`edulims-student`, `edulims-teacher`,
`edulims-admin`) that eduLIMS maps to its own role at every sign-in
([Identity providers](/operations/identity-providers/)).

## Sign in with the development login

With `EDULIMS_DEV_LOGIN=true` (the example env file's default) and after
`pnpm db:seed`, the sign-in page also offers an email and password form:

| Role          | Email                  | Password           |
| ------------- | ---------------------- | ------------------ |
| Student       | `student@example.test` | `eduLIMS-dev-only` |
| Teacher       | `teacher@example.test` | `eduLIMS-dev-only` |
| Administrator | `admin@example.test`   | `eduLIMS-dev-only` |

The server refuses the development login when `NODE_ENV=production`, and the
seed refuses to run without the flag.

## The Keycloak admin console

The admin console at <http://localhost:8180> is a different account in a
different realm (`master`): username `admin`, password `admin`. It manages
Keycloak itself (users, roles, clients); it does not sign in to eduLIMS.

## Start again from a clean slate

`pnpm db:reset` empties the local development database, migrates it and runs
the seed again. The Keycloak realm is imported again whenever its container
is recreated (`pnpm dev:db:stop`, then `pnpm dev:db`).
