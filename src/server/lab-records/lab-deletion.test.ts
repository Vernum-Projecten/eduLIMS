// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A lab with records is never deleted (maintainer, 2026-11-20 on #268 and #352): once its last
// member is removed, deleteLab still refuses it with `has_records`, logged, and the patients,
// requests and corrections stay. The cascade stays for deleting a whole simulation.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { deleteLab } from "../simulations/labs.ts";
import { removeMember } from "../simulations/members.ts";
import { auditRows, NOW } from "../simulations/test-helpers.ts";
import { registerReader, uploaded } from "../upload/test-helpers.ts";
import { correctPatient } from "./patients.ts";
import { PATIENT, patientIn, recordsWorld, requestFor } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function counts(database: Kysely<DB>, labId: string) {
  const [patients, requests, corrections] = await Promise.all(
    (["patients", "requests", "record_corrections"] as const).map((table) =>
      database.selectFrom(table).select("id").where("lab_id", "=", labId).execute(),
    ),
  );
  return {
    patients: patients?.length,
    requests: requests?.length,
    corrections: corrections?.length,
  };
}

describe("deleting a lab with records (has_records)", () => {
  it("is refused once the last member is removed, logged, and the records stay", async () => {
    const database = await createTestDb();
    db = database;
    const w = await recordsWorld(database);
    const patientId = await patientIn(database, w.student, w.labId);
    await requestFor(database, w.student, w.labId, patientId, [w.hba1c]);
    await correctPatient(database, w.student, {
      labId: w.labId,
      patientId,
      ...PATIENT,
      name: "Ada Corrected",
    });
    for (const member of w.labStudents) {
      const removed = await removeMember(
        database,
        w.teacher,
        { simulationId: w.simulationId, userId: member.id },
        NOW,
      );
      expect(removed.ok).toBe(true);
    }
    expect(await deleteLab(database, w.teacher, { labId: w.labId })).toEqual({
      ok: false,
      error: "has_records",
    });
    expect(await counts(database, w.labId)).toEqual({ patients: 1, requests: 1, corrections: 1 });
    expect(await auditRows(database, "lab_deleted")).toEqual([
      expect.objectContaining({
        outcome: "refused",
        reason_code: "has_records",
        target_id: w.labId,
      }),
    ]);
  });

  it("is refused for a lab with only a control request", async () => {
    const database = await createTestDb();
    db = database;
    const w = await recordsWorld(database);
    await database
      .insertInto("requests")
      .values({ simulation_id: w.simulationId, lab_id: w.otherLabId, kind: "control" })
      .execute();
    await database.deleteFrom("lab_members").where("lab_id", "=", w.otherLabId).execute();
    expect(await deleteLab(database, w.teacher, { labId: w.otherLabId })).toEqual({
      ok: false,
      error: "has_records",
    });
  });

  it("is refused for a lab with only a Gen5 upload (security review of #400, S4)", async () => {
    const database = await createTestDb();
    db = database;
    const w = await recordsWorld(database);
    await registerReader(database);
    await uploaded(database, w.otherLabStudent, w.otherLabId);
    await database.deleteFrom("lab_members").where("lab_id", "=", w.otherLabId).execute();
    expect(await deleteLab(database, w.teacher, { labId: w.otherLabId })).toEqual({
      ok: false,
      error: "has_records",
    });
    const uploads = await database
      .selectFrom("uploads")
      .select("id")
      .where("lab_id", "=", w.otherLabId)
      .execute();
    expect(uploads).toHaveLength(1);
  });
});
