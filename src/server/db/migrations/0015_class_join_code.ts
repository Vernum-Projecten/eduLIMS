// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The join code of a class (#49): at most one per class, off by default (no row). Only a keyed
// hash of the code is stored, so the table alone never gives a code away. Turning the code off
// deletes the row; regenerating replaces the hash and starts the uses at zero.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("class_join_codes")
    .addColumn("organization_id", "text", (col) =>
      col.primaryKey().references("organization.id").onDelete("cascade"),
    )
    // HMAC-SHA-256 of the normalised code, hex: the lookup key of a join.
    .addColumn("code_hash", "text", (col) => col.notNull().unique())
    .addColumn("created_by", "text", (col) => col.references("user.id").onDelete("set null"))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("max_uses", "integer", (col) => col.notNull())
    .addColumn("uses", "integer", (col) => col.notNull().defaultTo(0))
    .addCheckConstraint("class_join_code_hash", sql`code_hash ~ '^[0-9a-f]{64}$'`)
    // NOTE: no requirement governs these bounds: our own design (src/lib/join-code.ts), on #49.
    .addCheckConstraint(
      "class_join_code_term",
      sql`expires_at > created_at and expires_at <= created_at + interval '30 days'`,
    )
    .addCheckConstraint("class_join_code_max_uses", sql`max_uses between 1 and 500`)
    .addCheckConstraint("class_join_code_uses", sql`uses between 0 and max_uses`)
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops every join code.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("class_join_codes").execute();
}
