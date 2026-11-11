<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0005. better-auth with Microsoft Entra ID and a PostgreSQL adapter

- Status: Accepted
- Date: 2026-11-11
- Deciders: maintainer
- Amended by: [0010](0010-vendor-neutral-oidc-entra-and-keycloak.md) (Keycloak as a second provider, roles from the provider)

## Context and problem statement

Users sign in with their institution account (S1). The first target
institution uses Microsoft Entra ID, and its IT department creates the app
registration. Sign-in uses OpenID Connect with the authorization code flow and
PKCE. Roles (`student`, `teacher`, `admin`) come from Entra app roles or
groups (B1). eduLIMS needs server-side sessions and a place
to store users and roles.

## Decision drivers

- SSO-only sign-in (Q-SEC-1), with PKCE.
- Sessions stored in the eduLIMS database on the same PostgreSQL server.
- Works with TanStack Start server functions.
- A fallback while the Entra app registration is pending (project risk P-01).

## Considered options

- better-auth with its Microsoft Entra ID provider and its PostgreSQL adapter
  (Kysely).
- Auth.js.
- A hand-written OIDC client (`openid-client`) with own session tables.

## Decision outcome

Chosen option: **better-auth 1.7** with the Microsoft Entra ID provider (OIDC,
PKCE) and the built-in PostgreSQL adapter, which runs on Kysely and `pg`.

### Consequences

- Good: users, accounts and sessions live in the eduLIMS database, migrated
  next to the application tables.
- Good: the same query builder as the application
  ([0006](0006-kysely-for-app-data.md)).
- Good: until the institution's app registration exists, a development tenant or a
  local development-only sign-in can stand in; it is disabled in production.
- Bad: mapping Entra app roles or groups to eduLIMS roles is project code and
  needs tests (B1, Q-SEC-2).
