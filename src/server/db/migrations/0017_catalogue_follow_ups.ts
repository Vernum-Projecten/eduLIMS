// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Two rules of the test catalogue (D9, maintainer 2026-11-19 on #266): a test may have no unit,
// for a dimensionless result such as a ratio, and the analyte name of an active Afinion 2 test is
// unique regardless of case, so a result the analyser sends matches one test at most.
import { type Kysely, sql } from "kysely";

/** The longest unit (our own design, #266; `src/lib/catalogue.ts`). */
const UNIT_MAX = 20;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("catalogue_tests")
    .alterColumn("unit", (c) => c.dropNotNull())
    .execute();
  await db.schema.alterTable("catalogue_tests").dropConstraint("catalogue_tests_unit").execute();
  // NOTE: maintainer 2026-11-19 (#266); no unit is null, never an empty string.
  await db.schema
    .alterTable("catalogue_tests")
    .addCheckConstraint(
      "catalogue_tests_unit",
      sql`unit is null or (unit = btrim(unit) and char_length(unit) between 1 and ${sql.lit(UNIT_MAX)})`,
    )
    .execute();
  await db.schema
    .createIndex("catalogue_tests_active_analyte_key")
    .on("catalogue_tests")
    .unique()
    .expression(sql`lower(afinion_analyte)`)
    .where(sql.ref("source"), "=", "afinion")
    .where(sql.ref("retired_at"), "is", null)
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting fails loud while a test has no
// unit, rather than inventing one for it.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("catalogue_tests_active_analyte_key").execute();
  await db.schema.alterTable("catalogue_tests").dropConstraint("catalogue_tests_unit").execute();
  await db.schema
    .alterTable("catalogue_tests")
    .addCheckConstraint(
      "catalogue_tests_unit",
      sql`unit = btrim(unit) and char_length(unit) between 1 and ${sql.lit(UNIT_MAX)}`,
    )
    .execute();
  await db.schema
    .alterTable("catalogue_tests")
    .alterColumn("unit", (c) => c.setNotNull())
    .execute();
}
