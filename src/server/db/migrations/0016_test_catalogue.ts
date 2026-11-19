// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The test catalogue (D9, S4, #266): the tests teams can be asked to run, as data a teacher
// manages. A test names where its measurements come from; an Afinion 2 test the analyte in OBX-3,
// an Epoch 2 test who calculates the concentration, and only those. A retired test stays as a row
// for the simulations that used it; `retired_at` is set exactly while it is retired.
import { type Kysely, sql } from "kysely";

/** The bounds of the text columns (our own design, #266; `src/lib/catalogue.ts`). */
const NAME_MAX = 80;
const UNIT_MAX = 20;
const MATERIAL_MAX = 40;
const ANALYTE_MAX = 40;

function trimmedText(column: string, max: number) {
  return sql`${sql.ref(column)} = btrim(${sql.ref(column)}) and char_length(${sql.ref(column)}) between 1 and ${sql.lit(max)}`;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("catalogue_tests")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("unit", "text", (c) => c.notNull())
    .addColumn("material", "text", (c) => c.notNull())
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("afinion_analyte", "text")
    .addColumn("epoch_calculated_by", "text")
    // NOTE: #266; deleting the teacher who created a test keeps the test for every other teacher.
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("retired_at", "timestamptz")
    .addCheckConstraint("catalogue_tests_name", trimmedText("name", NAME_MAX))
    .addCheckConstraint("catalogue_tests_unit", trimmedText("unit", UNIT_MAX))
    .addCheckConstraint("catalogue_tests_material", trimmedText("material", MATERIAL_MAX))
    .addCheckConstraint(
      "catalogue_tests_source",
      sql`source in ('afinion', 'epoch_upload', 'manual')`,
    )
    .addCheckConstraint(
      "catalogue_tests_afinion_analyte",
      sql`(source = 'afinion') = (afinion_analyte is not null) and (afinion_analyte is null or (${trimmedText("afinion_analyte", ANALYTE_MAX)} and afinion_analyte !~ '[|^~\\\\&\\r\\n]'))`,
    )
    .addCheckConstraint(
      "catalogue_tests_epoch_calculated_by",
      sql`(source = 'epoch_upload') = (epoch_calculated_by is not null) and (epoch_calculated_by is null or epoch_calculated_by in ('team', 'edulims'))`,
    )
    .execute();

  // NOTE: #266; the names of active tests are unique case-insensitively, so a retired name is
  // free again and two parallel creates of one name cannot both commit.
  await db.schema
    .createIndex("catalogue_tests_active_name_key")
    .on("catalogue_tests")
    .unique()
    .expression(sql`lower(name)`)
    .where(sql.ref("retired_at"), "is", null)
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops the catalogue with every
// test in it.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("catalogue_tests").execute();
}
