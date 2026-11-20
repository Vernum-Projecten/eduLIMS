// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The state of a simulation (D10, #267): prepared, running, finished, never back; the times are
// the server's (Q-SIM-2); labs work only while it runs; and only a teacher of the simulation
// starts or finishes it.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { getTeacherSimulation, listTeacherSimulations } from "./queries.ts";
import { finishSimulation, startSimulation, toSimulationState } from "./state.ts";
import { findWorkingStudentLab } from "./student-access.ts";
import { teacherWriteRefusals } from "./test-access.ts";
import { auditRows, NOW, world } from "./test-helpers.ts";

const LATER = new Date("2026-11-19T12:00:00Z");

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  return { db, w: await world(db) };
}

describe("starting and finishing a simulation (D10, #267)", () => {
  it("starts a new simulation as prepared", async () => {
    const { db: database, w } = await open();
    const page = await getTeacherSimulation(database, w.teacher.id, w.simulationId);
    expect(page).toMatchObject({ state: "prepared", startedAt: null, finishedAt: null });
  });

  it("starts a prepared simulation at the server's time and logs it", async () => {
    const { db: database, w } = await open();
    const input = { simulationId: w.simulationId };
    expect(await startSimulation(database, w.teacher, input, NOW)).toEqual({
      ok: true,
      value: null,
    });
    const page = await getTeacherSimulation(database, w.teacher.id, w.simulationId);
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
    const page = await getTeacherSimulation(database, w.teacher.id, w.simulationId);
    expect(page).toMatchObject({ state: "finished", finishedAt: LATER.toISOString() });
    const list = await listTeacherSimulations(database, w.teacher.id);
    expect(list.find((row) => row.id === w.simulationId)?.state).toBe("finished");
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
