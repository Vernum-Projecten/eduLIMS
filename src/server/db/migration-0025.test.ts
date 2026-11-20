// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Migration 0025_result_ehr_write_lease (#382, S15): a pending write may carry the lease of the
// attempt that holds it, a written one never does, and `down` reverts it.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { withCheckDigit } from "../../lib/lab-number.ts";
import { createMigrator } from "./index.ts";
import type { DB } from "./schema.gen.ts";
import { createTestDb } from "./test-db.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe("0025_result_ehr_write_lease", () => {
  it("holds a lease on a pending write only, and reverts (#382)", async () => {
    const database = await createTestDb();
    db = database;
    const inSavepoint = (query: ReturnType<typeof sql>) =>
      database.transaction().execute((trx) => query.execute(trx));
    const one = async (query: ReturnType<typeof sql<{ id: string }>>) =>
      (await query.execute(database)).rows[0]?.id ?? "";
    const simulationId = await one(sql<{ id: string }>`
        insert into simulations (name) values ('Migration run') returning id`);
    const labId = await one(sql<{ id: string }>`insert into labs (simulation_id, name)
        values (${simulationId}, 'Migration lab') returning id`);
    const testId = await one(sql<{ id: string }>`insert into catalogue_tests
        (name, unit, material, source) values ('Migration test', 'mmol/L', 'plasma', 'manual')
        returning id`);
    const requestId = await one(sql<{ id: string }>`insert into requests
        (simulation_id, lab_id, kind) values (${simulationId}, ${labId}, 'control') returning id`);
    const sampleId = await one(sql<{ id: string }>`insert into samples
        (simulation_id, lab_id, request_id, sample_number, material, lab_number)
        values (${simulationId}, ${labId}, ${requestId}, 'QC-1', 'control',
          ${withCheckDigit("123456789")}) returning id`);
    await sql`insert into request_tests (request_id, test_id) values (${requestId}, ${testId})`.execute(
      database,
    );
    const measurementId = await one(sql<{ id: string }>`insert into measurements
        (simulation_id, lab_id, request_id, test_id, sample_id, value, source)
        values (${simulationId}, ${labId}, ${requestId}, ${testId}, ${sampleId}, 5.5, 'manual')
        returning id`);
    await sql`insert into result_ehr_writes (measurement_id, contribution_uid, lease_id)
        values (${measurementId}, uuidv7(), uuidv7())`.execute(database);
    await expect(
      inSavepoint(sql`update result_ehr_writes set state = 'written', version_uid = 'v::x::1',
          written_at = now()`),
    ).rejects.toThrow(/result_ehr_writes_lease/);
    await sql`update result_ehr_writes set state = 'written', version_uid = 'v::x::1',
        written_at = now(), lease_id = null`.execute(database);
    const down = await createMigrator(database).migrateTo("0024_result_ehr_writes");
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0027_gen5_uploads", "Success"],
      ["0025_result_ehr_write_lease", "Success"],
    ]);
    await expect(inSavepoint(sql`select lease_id from result_ehr_writes`)).rejects.toThrow(
      /column "lease_id" does not exist/,
    );
    expect((await createMigrator(database).migrateToLatest()).error).toBeUndefined();
  });
});
