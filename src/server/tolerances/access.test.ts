// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Who reaches a lab's tolerances after a change of membership (S10, S13; review of #352): a
// removed student reaches the former lab no more, and a student in labs of two simulations
// reaches each own lab, writes only where the simulation runs, and reaches no other lab.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { deleteLab } from "../simulations/labs.ts";
import { removeMember } from "../simulations/members.ts";
import {
  auditRows,
  NOW,
  notFoundLine,
  place,
  securityLines,
  setState,
} from "../simulations/test-helpers.ts";
import { setTolerance } from "./actions.ts";
import { readStudentTolerances } from "./queries.ts";
import { runningWorld, studentSets } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  const database = await createTestDb();
  db = database;
  return { database, ...(await runningWorld(database)) };
}

describe("a removed student (S10)", () => {
  it("neither reads nor writes the former lab's tolerances, and is logged as a probe", async () => {
    const { database, w, testId } = await open();
    await studentSets(database, w, testId, "4", "6");
    const removed = await removeMember(
      database,
      w.teacher,
      { simulationId: w.simulationId, userId: w.student.id },
      NOW,
    );
    expect(removed.ok).toBe(true);
    const removal = await database
      .selectFrom("simulation_removals")
      .select("user_id")
      .where("simulation_id", "=", w.simulationId)
      .execute();
    expect(removal).toEqual([{ user_id: w.student.id }]);
    const results: unknown[] = [];
    const lines = await securityLines(async () => {
      results.push(await readStudentTolerances(database, w.student, w.labId));
      results.push(
        await setTolerance(database, w.student, {
          labId: w.labId,
          testId,
          lower: "1",
          upper: "2",
        }),
      );
    });
    expect(results).toEqual([null, { ok: false, error: "not_found" }]);
    expect(lines).toEqual([
      notFoundLine(w.student.id, "lab", w.labId),
      notFoundLine(w.student.id, "lab", w.labId),
    ]);
    const rows = await database.selectFrom("lab_tolerances").select("lower_limit").execute();
    expect(rows).toHaveLength(1);
  });
});

describe("deleting a lab that has a tolerance (maintainer on #352, N1)", () => {
  it("is refused with has_records, logged, and the lab and its tolerance stay", async () => {
    const { database, w, testId } = await open();
    await studentSets(database, w, testId, "4", "6");
    // Test set-up: the lab's students are gone, so only its tolerance can block the deletion.
    await database.deleteFrom("lab_members").where("lab_id", "=", w.labId).execute();
    expect(await deleteLab(database, w.teacher, { labId: w.labId })).toEqual({
      ok: false,
      error: "has_records",
    });
    expect(await auditRows(database, "lab_deleted")).toMatchObject([
      { outcome: "refused", reason_code: "has_records", target_id: w.labId },
    ]);
    const lab = await database.selectFrom("labs").select("id").where("id", "=", w.labId).execute();
    expect(lab).toHaveLength(1);
    expect(await database.selectFrom("lab_tolerances").select("id").execute()).toHaveLength(1);
  });

  it("still deletes a lab without students or tolerances", async () => {
    const { database, w } = await open();
    await database.deleteFrom("lab_members").where("lab_id", "=", w.otherLabId).execute();
    expect(await deleteLab(database, w.teacher, { labId: w.otherLabId })).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe("a student in labs of two simulations (S10)", () => {
  it("reads each own lab, writes only where it runs, and reaches no other lab", async () => {
    const { database, w, testId } = await open();
    // NOTE: #386; one simulation runs at a time, so the other one ran before and is finished.
    await setState(database, w.outsideSimulationId, "finished");
    // NOTE: #379; beside a running simulation, a second place is only in a finished one.
    await place(database, w.outsideSimulationId, w.outsideLabId, w.student.id);

    expect((await readStudentTolerances(database, w.student, w.labId))?.state).toBe("running");
    expect((await readStudentTolerances(database, w.student, w.outsideLabId))?.state).toBe(
      "finished",
    );
    const input = { testId, lower: "1", upper: "2" };
    expect(await setTolerance(database, w.student, { ...input, labId: w.labId })).toEqual({
      ok: true,
      value: { changed: true },
    });
    expect(await setTolerance(database, w.student, { ...input, labId: w.outsideLabId })).toEqual({
      ok: false,
      error: "not_running",
    });
    expect(await readStudentTolerances(database, w.student, w.otherLabId)).toBeNull();
    expect(await setTolerance(database, w.student, { ...input, labId: w.otherLabId })).toEqual({
      ok: false,
      error: "not_found",
    });
    const own = await readStudentTolerances(database, w.student, w.outsideLabId);
    expect(own?.tests.find((t) => t.testId === testId)?.lower).toBeNull();
  });
});
