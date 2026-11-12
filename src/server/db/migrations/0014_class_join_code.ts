// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The join code of a class (#49): at most one per class, off by default (no row). Only a keyed
// hash of the code is stored, with a fingerprint of the key, so the table alone never gives a code
// away and a rotated key shows. Beside it: the counters of wrong codes per student and per client
// address (keyed hashes, never an address), and the students a teacher removed from a class.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("class_join_codes")
    .addColumn("organization_id", "text", (col) =>
      col.primaryKey().references("organization.id").onDelete("cascade"),
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
    .addCheckConstraint("class_join_code_hash", sql`code_hash ~ '^[0-9a-f]{64}$'`)
    .addCheckConstraint("class_join_code_key_fingerprint", sql`key_fingerprint ~ '^[0-9a-f]{16}$'`)
    // NOTE: no requirement governs these bounds: our own design (src/lib/join-code.ts), on #49.
    .addCheckConstraint(
      "class_join_code_term",
      sql`expires_at > created_at and expires_at <= created_at + interval '30 days'`,
    )
    .addCheckConstraint("class_join_code_max_uses", sql`max_uses between 1 and 500`)
    .addCheckConstraint("class_join_code_uses", sql`uses between 0 and max_uses`)
    .execute();

  await db.schema
    .createTable("class_join_attempts")
    // HMAC-SHA-256 (hex) of `user:<id>` or `ip:<address>`: no address is stored.
    .addColumn("key_hash", "text", (col) => col.primaryKey())
    .addColumn("window_start", "timestamptz", (col) => col.notNull())
    .addColumn("failures", "integer", (col) => col.notNull())
    .addCheckConstraint("class_join_attempt_key", sql`key_hash ~ '^[0-9a-f]{64}$'`)
    .addCheckConstraint("class_join_attempt_failures", sql`failures >= 0`)
    .execute();
  await db.schema
    .createIndex("class_join_attempts_window_start_idx")
    .on("class_join_attempts")
    .column("window_start")
    .execute();

  await db.schema
    .createTable("class_removals")
    .addColumn("organization_id", "text", (col) =>
      col.notNull().references("organization.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (col) => col.notNull().references("user.id").onDelete("cascade"))
    .addColumn("removed_by", "text", (col) => col.references("user.id").onDelete("set null"))
    .addColumn("removed_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("class_removals_pk", ["organization_id", "user_id"])
    .execute();
  await db.schema
    .createIndex("class_removals_user_id_idx")
    .on("class_removals")
    .column("user_id")
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops every join code, every
// counter and every removal record.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("class_removals").execute();
  await db.schema.dropTable("class_join_attempts").execute();
  await db.schema.dropTable("class_join_codes").execute();
}
