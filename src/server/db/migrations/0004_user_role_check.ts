// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Limits better-auth's `user.role` column to the allowed role sets in their stored form
// (ADR 0012), so a set written around eduLIMS (straight SQL) cannot reach the admin plugin,
// whose permission check splits the raw string. The application validates first
// (src/server/role-guard.ts); this is the last line. A database that already holds another
// value fails this migration: fix that row by hand, never by loosening the check.
import { type Kysely, sql } from "kysely";

const CONSTRAINT = "user_role_allowed_set";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("user")
    .addCheckConstraint(CONSTRAINT, sql`"role" in ('student', 'teacher', 'admin', 'teacher,admin')`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("user").dropConstraint(CONSTRAINT).execute();
}
