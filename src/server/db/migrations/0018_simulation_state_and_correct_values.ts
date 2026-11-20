// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The state of a simulation and its correct values (D10, D13, #267). A simulation is prepared,
// running or finished, with the server's time of each step. A correct value is keyed by the
// simulation, the sample number and the catalogue test, never by a lab, so every lab is judged
// against the same values. The accuracy limits are set per test within a simulation.
import { type Kysely, sql } from "kysely";

/** The bounds of `src/lib/correct-values.ts` and `src/lib/decimal.ts` (our own design, #267). */
const SAMPLE_NUMBER_MAX = 40;
const INTEGER_BOUND = "1000000000";
const FRACTION_DIGITS = 6;

function decimalWithinBounds(column: string) {
  return sql`abs(${sql.ref(column)}) < ${sql.lit(INTEGER_BOUND)}::numeric and scale(${sql.ref(column)}) <= ${sql.lit(FRACTION_DIGITS)}`;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("simulations")
    .addColumn("state", "text", (c) => c.notNull().defaultTo("prepared"))
    .addColumn("started_at", "timestamptz")
    .addColumn("finished_at", "timestamptz")
    .execute();
  // NOTE: #267; the times follow the state, so a running simulation always has its start.
  await db.schema
    .alterTable("simulations")
    .addCheckConstraint(
      "simulations_state",
      sql`state in ('prepared', 'running', 'finished')
        and (state = 'prepared') = (started_at is null)
        and (state = 'finished') = (finished_at is not null)
        and (finished_at is null or finished_at >= started_at)`,
    )
    .execute();

  await db.schema
    .createTable("correct_values")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("simulation_id", "uuid", (c) =>
      c.notNull().references("simulations.id").onDelete("cascade"),
    )
    // NOTE: D9 (#266); a test a simulation uses is never deleted, only retired.
    .addColumn("test_id", "uuid", (c) =>
      c.notNull().references("catalogue_tests.id").onDelete("restrict"),
    )
    .addColumn("sample_number", "text", (c) => c.notNull())
    .addColumn("value", "numeric", (c) => c.notNull())
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("updated_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      "correct_values_sample_number",
      sql`sample_number = btrim(sample_number) and char_length(sample_number) between 1 and ${sql.lit(SAMPLE_NUMBER_MAX)} and sample_number !~ '[[:cntrl:]]'`,
    )
    .addCheckConstraint("correct_values_value", decimalWithinBounds("value"))
    .execute();
  // NOTE: D10; one value per sample number and test in a simulation, the sample number compared
  // regardless of case.
  await db.schema
    .createIndex("correct_values_key")
    .on("correct_values")
    .unique()
    .expression(sql`simulation_id, lower(sample_number), test_id`)
    .execute();
  // The catalogue's usage rule reads the simulations that use a test.
  await db.schema
    .createIndex("correct_values_test_id_idx")
    .on("correct_values")
    .column("test_id")
    .execute();

  await db.schema
    .createTable("simulation_test_limits")
    .addColumn("simulation_id", "uuid", (c) =>
      c.notNull().references("simulations.id").onDelete("cascade"),
    )
    .addColumn("test_id", "uuid", (c) =>
      c.notNull().references("catalogue_tests.id").onDelete("restrict"),
    )
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("yellow_limit", "numeric", (c) => c.notNull())
    .addColumn("red_limit", "numeric", (c) => c.notNull())
    .addColumn("updated_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint("simulation_test_limits_pk", ["simulation_id", "test_id"])
    .addCheckConstraint("simulation_test_limits_kind", sql`kind in ('percent', 'absolute')`)
    .addCheckConstraint(
      "simulation_test_limits_values",
      sql`yellow_limit >= 0 and red_limit >= yellow_limit and ${decimalWithinBounds("yellow_limit")} and ${decimalWithinBounds("red_limit")}`,
    )
    .execute();
  await db.schema
    .createIndex("simulation_test_limits_test_id_idx")
    .on("simulation_test_limits")
    .column("test_id")
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops every correct value and
// limit, and the state of every simulation.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("simulation_test_limits").execute();
  await db.schema.dropTable("correct_values").execute();
  await db.schema.alterTable("simulations").dropConstraint("simulations_state").execute();
  await db.schema
    .alterTable("simulations")
    .dropColumn("finished_at")
    .dropColumn("started_at")
    .dropColumn("state")
    .execute();
}
