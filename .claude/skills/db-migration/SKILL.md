---
name: db-migration
description: Writes a Kysely migration for the eduLIMS PostgreSQL 18 database (up and down, constraints, uuidv7 keys, timestamptz), runs it against the Compose database, regenerates the Kysely Database types and proves it with tests. Use for any schema change (a new table, column, constraint, index or enum value).
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
argument-hint: "<snake_case_slug> e.g. add_requests_table"
---

<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# /db-migration

One schema change, held to `.claude/rules/database.md`. Read it first, and
the Kysely migration docs (<https://kysely.dev/docs/migrations>) for the
pinned version.

## Before you write

1. Read the requirement behind the change (`/requirement-lookup`). A
   constraint the draft does not state (a value range, a uniqueness rule, a
   retention period) is a question for the owner before it becomes a `CHECK`.
2. Read the existing migrations in `src/server/db/migrations/` and the
   generated types under `src/server/db/` to see the current schema. A
   migration that has reached `main` is immutable: change the schema with a
   new one.
3. A released result belongs in FerroEHR as a composition
   (`integration.md`), and a released result is final (S15); every
   measurement lives in the eduLIMS database (`measurements`, #270), and
   FerroEHR receives only the released result (#148). No student's or teacher's personal data goes to FerroEHR, and
   correct values, tolerances and the link from a result to its team stay
   here (`database.md`).

## Write the migration

File `src/server/db/migrations/<NNNN>_<slug>.ts`, the next four-digit number after
the latest on `main` (`database.md`), registered in `migrations/index.ts`. A
parallel branch may take the same number: whichever merges second renames.

```ts
// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("requests")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("team_id", "uuid", (c) =>
      c.notNull().references("teams.id").onDelete("restrict"),
    )
    // A request for a control sample has no patient (S16).
    .addColumn("patient_id", "uuid", (c) =>
      c.references("patients.id").onDelete("restrict"),
    )
    .addColumn("phone_through", "boolean", (c) => c.notNull())
    // The time of entry is the server's, never the client's (Q-SIM-2).
    .addColumn("entered_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex("requests_team_id_idx").on("requests").column("team_id").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("requests").execute();
}
```

- The table and its columns above only illustrate the form; the real schema
  comes from the issue and `docs/lims-workflow.md`.
- Migrations take `Kysely<unknown>`: they must not depend on the generated
  types, which describe the schema after all migrations.
- `down` reverts `up`. A `down` that loses data says so in a `// NOTE:`.
- A data backfill is its own idempotent migration, never mixed into a schema
  change.

## Apply and regenerate

```bash
pnpm db:migrate            # apply to the Compose database
pnpm db:generate-types     # regenerate the Kysely Database interface
pnpm typecheck             # every query now compiles against the new schema
```

Commit the migration and the regenerated types together. Never edit the
generated file by hand (`generated_file_guard.sh` blocks it).

## Tests

- The migration runs from an empty database to the latest and back down one
  step without error (CI runs from empty on every PR).
- Each constraint has a negative test: a request without a team is refused
  (S10), a delete that the foreign key restricts is refused.
- Queries that use the new table filter by team, or by the teacher's own
  simulations, in SQL and have their role isolation tests (`auth-security.md`).

## Report

The migration file, the regenerated types file, the commands run with their
output, and any constraint you left out because the draft requirement did
not settle it (with the question for the owner).
