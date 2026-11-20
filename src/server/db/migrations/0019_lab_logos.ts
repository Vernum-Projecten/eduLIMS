// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The logo of a lab (D10, ADR 0021, #292): one image per lab, PNG or JPEG, stored in PostgreSQL so
// the database backup covers it and the read-only app container writes no file. The row holds the
// filtered bytes, their type, size, dimensions and SHA-256, and never the uploaded file name
// (ASVS 5.0 V5.3.2). It goes with its lab.
import { type Kysely, sql } from "kysely";

/** The limits of a logo (maintainer, #280 and #292; `src/lib/lab-logo.ts`). */
const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_MAX_SIDE = 1024;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("lab_logos")
    .addColumn("lab_id", "uuid", (c) => c.primaryKey().references("labs.id").onDelete("cascade"))
    .addColumn("content", "bytea", (c) => c.notNull())
    .addColumn("media_type", "text", (c) => c.notNull())
    .addColumn("byte_size", "integer", (c) => c.notNull())
    .addColumn("width", "integer", (c) => c.notNull())
    .addColumn("height", "integer", (c) => c.notNull())
    .addColumn("sha256", "bytea", (c) => c.notNull())
    .addColumn("updated_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint("lab_logos_media_type", sql`media_type in ('image/png', 'image/jpeg')`)
    .addCheckConstraint(
      "lab_logos_byte_size",
      sql`byte_size = octet_length(content) and byte_size between 1 and ${sql.lit(LOGO_MAX_BYTES)}`,
    )
    .addCheckConstraint(
      "lab_logos_dimensions",
      sql`width between 1 and ${sql.lit(LOGO_MAX_SIDE)} and height between 1 and ${sql.lit(LOGO_MAX_SIDE)}`,
    )
    .addCheckConstraint("lab_logos_sha256", sql`octet_length(sha256) = 32`)
    .execute();
}

// NOTE: #292; dropping the table drops every stored logo with it.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("lab_logos").execute();
}
