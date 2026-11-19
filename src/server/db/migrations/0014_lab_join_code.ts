// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The join code of a lab (S10, #288): at most one per lab, off by default (no row). Only a keyed
// hash of the code is stored, with a fingerprint of the key, so the table alone never gives a code
// away and a rotated key shows. Beside it: the counters of wrong codes per student and per client
// address (keyed hashes, never an address).
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("lab_join_codes")
    .addColumn("lab_id", "uuid", (col) =>
      col.primaryKey().references("labs.id").onDelete("cascade"),
    )
    // HMAC-SHA-256 of the normalised code, hex: the lookup key of a join.
    .addColumn("code_hash", "text", (col) => col.notNull().unique())
    // The first 16 hex digits of SHA-256 over the HMAC key: tells a code made under another key.
    .addColumn("key_fingerprint", "text", (col) => col.notNull())
    .addColumn("created_by", "text", (col) => col.references("user.id").onDelete("set null"))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("max_uses", "integer", (col) => col.notNull())
    .addColumn("uses", "integer", (col) => col.notNull().defaultTo(0))
    .addCheckConstraint("lab_join_code_hash", sql`code_hash ~ '^[0-9a-f]{64}$'`)
    .addCheckConstraint("lab_join_code_key_fingerprint", sql`key_fingerprint ~ '^[0-9a-f]{16}$'`)
    // NOTE: no requirement governs these bounds: our own design, kept from the class code (#49).
    .addCheckConstraint(
      "lab_join_code_term",
      sql`expires_at > created_at and expires_at <= created_at + interval '30 days'`,
    )
    .addCheckConstraint("lab_join_code_max_uses", sql`max_uses between 1 and 500`)
    .addCheckConstraint("lab_join_code_uses", sql`uses between 0 and max_uses`)
    .execute();

  await db.schema
    .createTable("lab_join_attempts")
    // HMAC-SHA-256 (hex) of `user:<id>` or `ip:<address>`: no address is stored.
    .addColumn("key_hash", "text", (col) => col.primaryKey())
    .addColumn("window_start", "timestamptz", (col) => col.notNull())
    .addColumn("failures", "integer", (col) => col.notNull())
    .addCheckConstraint("lab_join_attempt_key", sql`key_hash ~ '^[0-9a-f]{64}$'`)
    .addCheckConstraint("lab_join_attempt_failures", sql`failures >= 0`)
    .execute();
  await db.schema
    .createIndex("lab_join_attempts_window_start_idx")
    .on("lab_join_attempts")
    .column("window_start")
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops every join code and counter.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("lab_join_attempts").execute();
  await db.schema.dropTable("lab_join_codes").execute();
}
