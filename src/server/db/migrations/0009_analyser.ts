// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The analyser register (B3, #35): every lab analyser with its serial number, where it stands,
// how its results reach FerroEHR (HL7 v2 through FerroBRIDGE, or the Gen5 Excel upload) and
// whether it is in use. A retired analyser stays as a row, so results that name its serial
// number keep their device (Q-TRACE-1); `retired_at` is set exactly when the status is retired.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("analysers")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("model", "text", (c) => c.notNull())
    .addColumn("serial_number", "text", (c) => c.notNull())
    .addColumn("location", "text", (c) => c.notNull())
    .addColumn("route", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull().defaultTo("in_use"))
    .addColumn("notes", "text")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("retired_at", "timestamptz")
    .addCheckConstraint("analysers_model", sql`char_length(btrim(model)) between 1 and 100`)
    .addCheckConstraint(
      "analysers_serial_number",
      sql`char_length(btrim(serial_number)) between 1 and 64`,
    )
    .addCheckConstraint("analysers_location", sql`char_length(btrim(location)) between 1 and 120`)
    .addCheckConstraint("analysers_notes", sql`notes is null or char_length(notes) <= 1000`)
    .addCheckConstraint("analysers_route", sql`route in ('hl7_ferrobridge', 'excel_upload')`)
    .addCheckConstraint("analysers_status", sql`status in ('in_use', 'maintenance', 'retired')`)
    .addCheckConstraint(
      "analysers_retired_at",
      sql`(status = 'retired') = (retired_at is not null)`,
    )
    .addUniqueConstraint("analysers_model_serial_number_key", ["model", "serial_number"])
    .execute();

  await db.schema.createIndex("analysers_status_idx").on("analysers").column("status").execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops the register with every
// analyser in it.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("analysers").execute();
}
