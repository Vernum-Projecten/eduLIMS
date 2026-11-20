// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The tests a request form asks for that the lab does not offer (S12, #398): free text as written
// on the form, with an optional remark, stored per request and never matched against anything
// (Q-SIM-1). The lab key lets the teacher dashboard count them per lab (D11, #271).
import { type Kysely, sql } from "kysely";

/** The bounds of `src/lib/lab-records.ts` (our own design, #398). */
const NAME_MAX = 80;
const REMARK_MAX = 100;

/** A trimmed, non-empty text of at most `max` characters without control characters. */
function formText(column: string, max: number) {
  return sql`${sql.ref(column)} = btrim(${sql.ref(column)}) and char_length(${sql.ref(column)}) between 1 and ${sql.lit(max)} and ${sql.ref(column)} !~ '[[:cntrl:]]'`;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("request_tests_not_offered")
    .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn("lab_id", "uuid", (c) => c.notNull())
    .addColumn("request_id", "uuid", (c) => c.notNull())
    // NOTE: no requirement governs this: our own design; the order the team typed them in.
    .addColumn("position", "smallint", (c) => c.notNull())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("remark", "text")
    .addForeignKeyConstraint(
      "request_tests_not_offered_request_fkey",
      ["request_id", "lab_id"],
      "requests",
      ["id", "lab_id"],
      (c) => c.onDelete("cascade"),
    )
    .addUniqueConstraint("request_tests_not_offered_position_key", ["request_id", "position"])
    .addCheckConstraint("request_tests_not_offered_position", sql`position >= 0`)
    .addCheckConstraint("request_tests_not_offered_name", formText("name", NAME_MAX))
    .addCheckConstraint(
      "request_tests_not_offered_remark",
      sql`remark is null or (${formText("remark", REMARK_MAX)})`,
    )
    .execute();
  await db.schema
    .createIndex("request_tests_not_offered_lab_id_idx")
    .on("request_tests_not_offered")
    .column("lab_id")
    .execute();
}

// NOTE: no requirement governs this: our own design. Reverting drops every test not offered.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("request_tests_not_offered").execute();
}
