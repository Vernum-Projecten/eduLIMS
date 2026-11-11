<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# 0006. Kysely for application data

- Status: Accepted
- Date: 2026-11-11
- Deciders: maintainer

## Context and problem statement

The eduLIMS database holds users, classes, practicals, rubrics, sample IDs,
submissions, assessments and logs on PostgreSQL 18. The KPI queries (K-01 to
K-07) are aggregate SQL. eduLIMS needs typed queries and versioned
migrations.

## Decision drivers

- Type-safe SQL that still reads as SQL, for the KPI aggregates.
- One data access layer for better-auth and the application.
- Migrations under version control.

## Considered options

- Kysely with `pg`.
- Drizzle ORM.
- Prisma.

## Decision outcome

Chosen option: **Kysely with `pg`**. better-auth's PostgreSQL adapter already
runs on Kysely, so the application uses the same query builder, the same
connection pool and the same migration command (`pnpm db:migrate`).

### Consequences

- Good: one dependency and one pool for auth and application data.
- Good: dashboard aggregates are typed SQL without an ORM layer in between.
- Bad: no ORM relations; joins are written by hand.
- Bad: database types must follow the migrations. CI applies all migrations
  to a fresh database.
