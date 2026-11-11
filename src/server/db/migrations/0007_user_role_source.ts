// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Hybrid role ownership (owner decision on #32, B1): where a user's role set comes from, the
// last sign-in time and the last sign-in method. The IdP sync replaces the whole set when the
// identity provider sends a mapped role, so a set has exactly one source: one column, not a
// per-role map. `role_source` and `last_login_method` are declared to better-auth in
// src/server/auth.ts; `last_sign_in_at` is written by eduLIMS's sign-in hook only.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("user")
    .addColumn("role_source", "text", (col) =>
      col
        .notNull()
        .defaultTo("local")
        .check(sql`"role_source" in ('local', 'microsoft', 'keycloak')`),
    )
    .addColumn("last_sign_in_at", "timestamptz")
    .addColumn("last_login_method", "text", (col) =>
      col.check(sql`"last_login_method" in ('microsoft', 'keycloak', 'credential')`),
    )
    .execute();
  await db.schema
    .createIndex("user_last_sign_in_at_idx")
    .on("user")
    .column("last_sign_in_at")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // NOTE: drops the role sources and the sign-in times and methods of every user.
  await db.schema.dropIndex("user_last_sign_in_at_idx").execute();
  await db.schema
    .alterTable("user")
    .dropColumn("last_login_method")
    .dropColumn("last_sign_in_at")
    .dropColumn("role_source")
    .execute();
}
