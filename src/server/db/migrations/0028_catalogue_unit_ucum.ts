// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A test's unit is a UCUM code from the supported list (D9; owner 2026-11-20 on #393; security
// review of #404, F1), so the database refuses what the server function and the service refuse.
// The list is written out here, frozen with the migration; `migration-0028.test.ts` fails when it
// and `UCUM_CODES` in src/lib/ucum.ts differ, so a new unit comes with a new migration.
import { type Kysely, sql } from "kysely";

/** The supported UCUM codes when this migration was written (https://ucum.org/ucum, c/s). */
export const UCUM_CODES_0028 = [
  "mmol/L",
  "umol/L",
  "mg/L",
  "mg/dL",
  "g/L",
  "%",
  "mmol/mol",
  "mg/mmol",
  "mg/g",
  "U/L",
  "10*9/L",
  "nmol/L",
  "pmol/L",
  "g/dL",
  "ug/L",
  "ng/mL",
  "pg/mL",
  "[IU]/L",
  "m[IU]/L",
  "10*12/L",
  "mosm/kg",
  "[pH]",
  "s",
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("catalogue_tests")
    .addCheckConstraint(
      "catalogue_tests_unit_ucum",
      sql`unit is null or unit in (${sql.join(UCUM_CODES_0028.map((code) => sql.lit(code)))})`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("catalogue_tests")
    .dropConstraint("catalogue_tests_unit_ucum")
    .execute();
}
