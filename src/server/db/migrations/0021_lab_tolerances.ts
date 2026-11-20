// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A team's own tolerances (S13, #269): per lab and catalogue test, one lower and one upper limit.
// Every change is a new row and no row is ever updated, so the teacher reads every change and a
// release (S15, #270) can name the exact row that was in force. The newest row of a lab and test
// is its current tolerance.
import { type Kysely, sql } from "kysely";

/** The bounds of `src/lib/decimal.ts`, as migration 0018 holds them for correct values. */
const INTEGER_BOUND = "1000000000";
const FRACTION_DIGITS = 6;

function decimalWithinBounds(column: string) {
  return sql`abs(${sql.ref(column)}) < ${sql.lit(INTEGER_BOUND)}::numeric and scale(${sql.ref(column)}) <= ${sql.lit(FRACTION_DIGITS)}`;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("lab_tolerances")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("simulation_id", "uuid", (c) => c.notNull())
    .addColumn("lab_id", "uuid", (c) => c.notNull())
    // NOTE: D9 (#266); a test a lab has a tolerance for is never deleted, only retired.
    .addColumn("test_id", "uuid", (c) =>
      c.notNull().references("catalogue_tests.id").onDelete("restrict"),
    )
    .addColumn("lower_limit", "numeric", (c) => c.notNull())
    .addColumn("upper_limit", "numeric", (c) => c.notNull())
    .addColumn("set_by", "text", (c) => c.references("user.id").onDelete("set null"))
    // NOTE: Q-SIM-2; the database clock at the insert, after the lab lock, so rows of one lab
    // and test follow the order in which they were written.
    .addColumn("set_at", "timestamptz", (c) => c.notNull().defaultTo(sql`clock_timestamp()`))
    .addForeignKeyConstraint(
      "lab_tolerances_lab_fkey",
      ["lab_id", "simulation_id"],
      "labs",
      ["id", "simulation_id"],
      (fk) => fk.onDelete("cascade"),
    )
    // NOTE: S13 and the database rules; a lower limit is never above the upper limit, and a
    // value equal to a limit is inside, so equal limits are allowed.
    .addCheckConstraint(
      "lab_tolerances_limits",
      sql`lower_limit <= upper_limit and ${decimalWithinBounds("lower_limit")} and ${decimalWithinBounds("upper_limit")}`,
    )
    .execute();
  // The current tolerance of a lab and test is its newest row.
  await db.schema
    .createIndex("lab_tolerances_current_idx")
    .on("lab_tolerances")
    .expression(sql`lab_id, test_id, set_at desc, id desc`)
    .execute();
  // The catalogue's restricting foreign key reads the tolerances of a test.
  await db.schema
    .createIndex("lab_tolerances_test_id_idx")
    .on("lab_tolerances")
    .column("test_id")
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops every tolerance.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("lab_tolerances").execute();
}
