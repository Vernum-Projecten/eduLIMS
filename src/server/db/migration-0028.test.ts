// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Migration 0028_catalogue_unit_ucum (D9, #393; security review of #404, F1): the database holds
// a test's unit to the supported UCUM list, the list matches the application's, and `down`
// reverts it.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { UCUM_CODES } from "../../lib/ucum.ts";
import { createMigrator } from "./index.ts";
import { UCUM_CODES_0028 } from "./migrations/0028_catalogue_unit_ucum.ts";
import type { DB } from "./schema.gen.ts";
import { createTestDb } from "./test-db.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

/** Inserts a manual test with `unit` in a savepoint, so a refusal keeps the transaction usable. */
function insert(database: Kysely<DB>, name: string, unit: string | null) {
  return database.transaction().execute((trx) =>
    sql`insert into catalogue_tests (name, unit, material, source)
        values (${name}, ${unit}, 'plasma', 'manual')`.execute(trx),
  );
}

describe("0028_catalogue_unit_ucum", () => {
  it("lists exactly the units the application supports, so a new unit needs a migration", () => {
    expect([...UCUM_CODES_0028]).toEqual([...UCUM_CODES]);
  });

  it("refuses a code outside the list with a check violation, and takes a listed one or none", async () => {
    const database = await createTestDb();
    db = database;
    const refused: unknown = await insert(database, "Lower case", "mmol/l").catch(
      (error: unknown) => error,
    );
    expect(refused).toMatchObject({ code: "23514", constraint: "catalogue_tests_unit_ucum" });
    await insert(database, "Listed", "umol/L");
    await insert(database, "No unit", null);
  });

  it("reverts, and applies again", async () => {
    const database = await createTestDb();
    db = database;
    const down = await createMigrator(database).migrateTo("0027_gen5_uploads");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0029_request_tests_not_offered", "Success"],
      ["0028_catalogue_unit_ucum", "Success"],
    ]);
    await insert(database, "Free text again", "ratio");
    await sql`delete from catalogue_tests`.execute(database);
    expect((await createMigrator(database).migrateToLatest()).error).toBeUndefined();
  });
});
