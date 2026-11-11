---
title: Demo accounts
description: The accounts to sign in with on a development machine, for each role set, for Keycloak and for the development login.
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
**Sign in with Keycloak**, then use one of these. The password is the
username.

| Username         | Roles in eduLIMS          | How Keycloak grants them                                  | Lands on   |
| ---------------- | ------------------------- | --------------------------------------------------------- | ---------- |
| `student`        | Student                   | group `Students`                                          | `/student` |
| `teacher`        | Teacher                   | group `Teachers`                                          | `/teacher` |
| `admin`          | Administrator             | realm role `edulims-admin`, assigned directly             | `/admin`   |
| `coordinator`    | Teacher and Administrator | groups `Teachers` and `Administrators`                    | `/teacher` |
| `teacher-direct` | Teacher                   | realm role `edulims-teacher`, assigned directly           | `/teacher` |
| `mixed`          | Teacher and Administrator | group `Teachers`, and realm role `edulims-admin` directly | `/teacher` |
| `conflict`       | refused                   | groups `Students` and `Teachers`                          | `/login` with "conflicting roles" |
| `norole`         | refused                   | no eduLIMS role                                           | `/login` with "no role" |

Each group carries one realm role (`Students` has `edulims-student`,
`Teachers` has `edulims-teacher`, `Administrators` has `edulims-admin`). The
realm's protocol mapper writes the effective realm roles, direct and from
groups, to `realm_access.roles` in the ID token, and eduLIMS maps them to its
own roles at every sign-in. A second mapper writes the group paths to
`groups`, so `OIDC_ROLE_CLAIM=groups` can be tried as well
([Identity providers](/operations/identity-providers/)).

Student is never combined with another role, so `conflict` is refused.
A teacher-administrator lands on the Teacher portal the first time and on
the portal they last switched to after that.

The realm is imported only when the Keycloak container is created. After a
change to the realm file, recreate it: `pnpm dev:db:stop`, then `pnpm dev:db`.

## Sign in with the development login

With `EDULIMS_DEV_LOGIN=true` (the example env file's default) and after
`pnpm db:seed`, the sign-in page also offers an email and password form:

| Roles                     | Email                        | Password           |
| ------------------------- | ---------------------------- | ------------------ |
| Student                   | `student@example.test`       | `eduLIMS-dev-only` |
| Teacher                   | `teacher@example.test`       | `eduLIMS-dev-only` |
| Administrator             | `admin@example.test`         | `eduLIMS-dev-only` |
| Teacher and Administrator | `teacher-admin@example.test` | `eduLIMS-dev-only` |

The server refuses the development login when `NODE_ENV=production`, and the
seed refuses to run without the flag.

## The Keycloak admin console

The admin console at <http://localhost:8180> is a different account in a
different realm (`master`): username `admin`, password `admin`. It manages
Keycloak itself (users, roles, groups, clients); it does not sign in to
eduLIMS.

## Start again from a clean slate

`pnpm db:reset` empties the local development database, migrates it and runs
the seed again. The Keycloak realm is imported again whenever its container
is recreated (`pnpm dev:db:stop`, then `pnpm dev:db`).
