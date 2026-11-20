// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The state of a simulation (D10, #267): prepared, running, finished, never back; the times are
// the server's (Q-SIM-2); labs work only while it runs; and only a teacher of the simulation
// starts or finishes it.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { setCorrectValues, setLimits } from "../correct-values/actions.ts";
import { catalogueTest, seedSecrets } from "../correct-values/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { getTeacherSimulation, listTeacherSimulations } from "./queries.ts";
import { createSimulation, deleteSimulation } from "./simulations.ts";
import { finishSimulation, startSimulation, toSimulationState } from "./state.ts";
import { findWorkingStudentLab } from "./student-access.ts";
import { teacherWriteRefusals } from "./test-access.ts";
import { auditRows, NOW, setState, startable, world } from "./test-helpers.ts";
import { key } from "./test-join.ts";

const LATER = new Date("2026-11-19T12:00:00Z");

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

/** The world, its first simulation ready to start: a student in a lab and a correct value. */
async function open() {
  db = await createTestDb();
  const w = await world(db);
  await startable(db, w.simulationId);
  return { db, w };
}

describe("starting and finishing a simulation (D10, #267)", () => {
  it("starts a new simulation as prepared", async () => {
    const { db: database, w } = await open();
    const page = await getTeacherSimulation(
      database,
      w.teacher.id,
      w.simulationId,
      NOW,
      key.fingerprint,
    );
    expect(page).toMatchObject({ state: "prepared", startedAt: null, finishedAt: null });
  });

  it("starts a prepared simulation at the server's time and logs it", async () => {
    const { db: database, w } = await open();
    const input = { simulationId: w.simulationId };
    expect(await startSimulation(database, w.teacher, input, NOW)).toEqual({
      ok: true,
      value: null,
    });
    const page = await getTeacherSimulation(
      database,
      w.teacher.id,
      w.simulationId,
      NOW,
      key.fingerprint,
    );
    expect(page).toMatchObject({
      state: "running",
      startedAt: NOW.toISOString(),
      finishedAt: null,
    });
    expect(await auditRows(database, "simulation_started")).toEqual([
      expect.objectContaining({ outcome: "success", target_id: w.simulationId }),
    ]);
  });

  it("finishes a running simulation and shows the state in the teacher's list", async () => {
    const { db: database, w } = await open();
    const input = { simulationId: w.simulationId };
    await startSimulation(database, w.teacher, input, NOW);
    expect(await finishSimulation(database, w.coTeacher, input, LATER)).toEqual({
      ok: true,
      value: null,
    });
    const page = await getTeacherSimulation(
      database,
      w.teacher.id,
      w.simulationId,
      NOW,
      key.fingerprint,
    );
    expect(page).toMatchObject({ state: "finished", finishedAt: LATER.toISOString() });
    const list = await listTeacherSimulations(database, w.teacher.id);
    expect(list.find((row) => row.id === w.simulationId)?.state).toBe("finished");
  });

  it("refuses a start without a student in any lab with no_students, and logs it (#394)", async () => {
    const { db: database, w } = await open();
    await database.deleteFrom("lab_members").where("simulation_id", "=", w.simulationId).execute();
    const input = { simulationId: w.simulationId };
    expect(await startSimulation(database, w.teacher, input, NOW)).toEqual({
      ok: false,
      error: "no_students",
    });
    expect(await auditRows(database, "simulation_started")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "no_students" }),
    ]);
    const page = await getTeacherSimulation(
      database,
      w.teacher.id,
      w.simulationId,
      NOW,
      key.fingerprint,
    );
    expect(page).toMatchObject({ state: "prepared", startedAt: null });
  });

  it("refuses a start without a correct value with no_correct_values, and logs it (#394)", async () => {
    const { db: database, w } = await open();
    await database
      .deleteFrom("correct_values")
      .where("simulation_id", "=", w.simulationId)
      .execute();
    const input = { simulationId: w.simulationId };
    expect(await startSimulation(database, w.teacher, input, NOW)).toEqual({
      ok: false,
      error: "no_correct_values",
    });
    expect(await auditRows(database, "simulation_started")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "no_correct_values" }),
    ]);
  });

  it("starts once a lab has one student, even beside an empty lab (#394)", async () => {
    const { db: database, w } = await open();
    await database.deleteFrom("lab_members").where("lab_id", "=", w.labId).execute();
    const input = { simulationId: w.simulationId };
    expect((await startSimulation(database, w.teacher, input, NOW)).ok).toBe(true);
  });

  it("refuses a second start, and a start after the finish, with not_prepared", async () => {
    const { db: database, w } = await open();
    const input = { simulationId: w.simulationId };
    await startSimulation(database, w.teacher, input, NOW);
    expect(await startSimulation(database, w.teacher, input, LATER)).toEqual({
      ok: false,
      error: "not_prepared",
    });
    await finishSimulation(database, w.teacher, input, LATER);
    expect(await startSimulation(database, w.teacher, input, LATER)).toEqual({
      ok: false,
      error: "not_prepared",
    });
    expect(await auditRows(database, "simulation_started")).toEqual([
      expect.objectContaining({ outcome: "success" }),
      expect.objectContaining({ outcome: "refused", reason_code: "not_prepared" }),
      expect.objectContaining({ outcome: "refused", reason_code: "not_prepared" }),
    ]);
  });

  it("refuses to finish a prepared or a finished simulation with not_running", async () => {
    const { db: database, w } = await open();
    const input = { simulationId: w.simulationId };
    expect(await finishSimulation(database, w.teacher, input, NOW)).toEqual({
      ok: false,
      error: "not_running",
    });
    await startSimulation(database, w.teacher, input, NOW);
    await finishSimulation(database, w.teacher, input, LATER);
    expect(await finishSimulation(database, w.teacher, input, LATER)).toEqual({
      ok: false,
      error: "not_running",
    });
  });

  it("is held by the database: a running simulation without its start time is refused", async () => {
    const { db: database, w } = await open();
    await expect(
      database
        .updateTable("simulations")
        .set({ state: "running" })
        .where("id", "=", w.simulationId)
        .execute(),
    ).rejects.toThrow(/simulations_state/);
  });

  it("fails loud on a state it does not know", () => {
    expect(() => toSimulationState("paused")).toThrow(/not a known state/);
  });

  it("refuses a start while a test with a correct value has no limits, naming it (maintainer 2026-11-20)", async () => {
    const { db: database, w } = await open();
    // The seeded test has its limits, so the refusal names only the two below.
    await seedSecrets(database, w);
    const without = await catalogueTest(database, "Albumin (invented)");
    const second = await catalogueTest(database, "Urea (invented)");
    const set = await setCorrectValues(
      database,
      w.teacher,
      {
        simulationId: w.simulationId,
        rows: [
          { sampleNumber: "S-001", testId: without, value: "1" },
          { sampleNumber: "S-002", testId: without, value: "2" },
          { sampleNumber: "S-001", testId: second, value: "3" },
        ],
      },
      NOW,
    );
    expect(set.ok).toBe(true);
    const input = { simulationId: w.simulationId };
    expect(await startSimulation(database, w.teacher, input, NOW)).toEqual({
      ok: false,
      error: "missing_limits",
      testIds: [without, second].sort(),
    });
    expect(await auditRows(database, "simulation_started")).toEqual([
      expect.objectContaining({
        outcome: "refused",
        reason_code: "missing_limits",
        metadata: null,
      }),
    ]);
    const page = await getTeacherSimulation(
      database,
      w.teacher.id,
      w.simulationId,
      NOW,
      key.fingerprint,
    );
    expect(page?.state).toBe("prepared");
    for (const testId of [without, second]) {
      await setLimits(
        database,
        w.teacher,
        { ...input, testId, kind: "absolute", yellow: "1", red: "2" },
        NOW,
      );
    }
    expect(await startSimulation(database, w.teacher, input, NOW)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("refuses to delete a running simulation, even without students, and logs it (maintainer 2026-11-20)", async () => {
    const { db: database, w } = await open();
    const created = await createSimulation(database, w.teacher, { name: "Empty run" }, NOW);
    if (!created.ok) throw new Error(created.error);
    const input = { simulationId: created.value.simulationId };
    // Without a student the service refuses the start (no_students), so the state is set here.
    await setState(database, input.simulationId, "running");
    expect(await deleteSimulation(database, w.teacher, input)).toEqual({
      ok: false,
      error: "running",
    });
    expect(await auditRows(database, "simulation_deleted")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "running" }),
    ]);
    await finishSimulation(database, w.teacher, input, LATER);
    expect(await deleteSimulation(database, w.teacher, input)).toEqual({ ok: true, value: null });
  });

  it("still refuses to delete a finished simulation with a student (has_students)", async () => {
    const { db: database, w } = await open();
    const input = { simulationId: w.simulationId };
    await startSimulation(database, w.teacher, input, NOW);
    await finishSimulation(database, w.teacher, input, LATER);
    expect(await deleteSimulation(database, w.teacher, input)).toEqual({
      ok: false,
      error: "has_students",
    });
  });

  describe("start", () => {
    teacherWriteRefusals({
      call: (database, _w, actor, target) =>
        startSimulation(database, actor, { simulationId: target }, NOW),
      target: (w) => ({ type: "simulation", id: w.simulationId }),
    });
  });

  describe("finish", () => {
    teacherWriteRefusals({
      prepare: async (database, w) => {
        await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
      },
      call: (database, _w, actor, target) =>
        finishSimulation(database, actor, { simulationId: target }, LATER),
      target: (w) => ({ type: "simulation", id: w.simulationId }),
    });
  });
});

describe("one running simulation at a time (D11, owner 2026-11-20, #386)", () => {
  it("refuses a start while another teacher's simulation runs, logs it, and names none", async () => {
    const { db: database, w } = await open();
    const other = { simulationId: w.outsideSimulationId };
    await startable(database, w.outsideSimulationId);
    expect((await startSimulation(database, w.outsiderTeacher, other, NOW)).ok).toBe(true);
    const refusedStart = await startSimulation(
      database,
      w.teacher,
      { simulationId: w.simulationId },
      LATER,
    );
    expect(refusedStart).toEqual({ ok: false, error: "another_running" });
    expect(JSON.stringify(refusedStart)).not.toContain(w.outsideSimulationId);
    const page = await getTeacherSimulation(
      database,
      w.teacher.id,
      w.simulationId,
      NOW,
      key.fingerprint,
    );
    expect(page).toMatchObject({ state: "prepared", startedAt: null });
    expect(await auditRows(database, "simulation_started")).toEqual([
      expect.objectContaining({ outcome: "success", target_id: w.outsideSimulationId }),
      expect.objectContaining({
        outcome: "refused",
        reason_code: "another_running",
        target_id: w.simulationId,
      }),
    ]);
  });

  it("lets the next simulation start once the running one is finished", async () => {
    const { db: database, w } = await open();
    const other = { simulationId: w.outsideSimulationId };
    await startable(database, w.outsideSimulationId);
    expect((await startSimulation(database, w.outsiderTeacher, other, NOW)).ok).toBe(true);
    await finishSimulation(database, w.outsiderTeacher, other, LATER);
    const start = await startSimulation(
      database,
      w.teacher,
      { simulationId: w.simulationId },
      LATER,
    );
    expect(start).toEqual({ ok: true, value: null });
  });

  it("is held by the database: a second running row is a unique violation", async () => {
    const { db: database, w } = await open();
    await setState(database, w.outsideSimulationId, "running");
    await expect(setState(database, w.simulationId, "running")).rejects.toMatchObject({
      code: "23505",
      constraint: "simulations_one_running",
    });
  });
});

describe("labs work only in a running simulation (D10, #267)", () => {
  it("gives a member no working lab while the simulation is prepared", async () => {
    const { db: database, w } = await open();
    expect(await findWorkingStudentLab(database, w.student.id, w.labId)).toBeNull();
  });

  it("gives a member their lab while it runs", async () => {
    const { db: database, w } = await open();
    await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await findWorkingStudentLab(database, w.student.id, w.labId)).toEqual({
      labId: w.labId,
      simulationId: w.simulationId,
    });
  });

  it("gives no working lab once it is finished", async () => {
    const { db: database, w } = await open();
    await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, LATER);
    expect(await findWorkingStudentLab(database, w.student.id, w.labId)).toBeNull();
  });

  it("gives a student of another lab, or a malformed id, nothing while it runs (R-01)", async () => {
    const { db: database, w } = await open();
    await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await findWorkingStudentLab(database, w.otherLabStudent.id, w.labId)).toBeNull();
    expect(await findWorkingStudentLab(database, w.outsideStudent.id, w.labId)).toBeNull();
    expect(await findWorkingStudentLab(database, w.student.id, "not-a-uuid")).toBeNull();
  });
});
