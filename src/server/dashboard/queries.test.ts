// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teacher dashboard's read (D11, D13, G-01, G-03, #271, #386): the running simulation's
// board for its teachers, nothing for anyone else, the times from the server and the accuracy
// from the one tested function. Every value is invented (Q-PRIV-4).
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardCell, TeacherDashboard } from "../../lib/dashboard-board.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { patientIn, requestFor } from "../lab-records/test-helpers.ts";
import { AuthError } from "../middleware.ts";
import { releaseResult } from "../results/release.ts";
import { measure, type ResultsWorld, resultsWorld } from "../results/test-helpers.ts";
import { finishSimulation } from "../simulations/state.ts";
import { NOW, type Person, world } from "../simulations/test-helpers.ts";
import { columnKey, readTeacherDashboard } from "./queries.ts";

const READ_AT = new Date("2026-11-19T10:00:00Z");

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

/** Stores a correct value and, unless `limits` is null, the test's limits (test set-up only). */
async function answer(
  database: Kysely<DB>,
  w: ResultsWorld,
  sampleNumber: string,
  testId: string,
  value: string,
  limits: { kind: "absolute" | "percent"; yellow: string; red: string } | null,
) {
  await database
    .insertInto("correct_values")
    .values({ simulation_id: w.simulationId, sample_number: sampleNumber, test_id: testId, value })
    .execute();
  if (limits === null) return;
  await database
    .insertInto("simulation_test_limits")
    .values({
      simulation_id: w.simulationId,
      test_id: testId,
      kind: limits.kind,
      yellow_limit: limits.yellow,
      red_limit: limits.red,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

async function open() {
  const database = await createTestDb();
  db = database;
  const w = await resultsWorld(database);
  await answer(database, w, "S-001", w.hba1c, "5.0", {
    kind: "absolute",
    yellow: "0.2",
    red: "0.5",
  });
  await answer(database, w, "S-001", w.crp, "10", { kind: "percent", yellow: "5", red: "10" });
  return { database, w };
}

async function release(database: Kysely<DB>, w: ResultsWorld, value: string) {
  const measurementId = await measure(database, w, value);
  const released = await releaseResult(database, w.student, {
    labId: w.labId,
    requestId: w.requestId,
    testId: w.hba1c,
    measurementId,
    toleranceId: w.toleranceId,
  });
  if (!released.ok) throw new Error(released.error);
}

function board(read: TeacherDashboard) {
  if (read.kind !== "running") throw new Error(`no board: ${read.kind}`);
  return read;
}

function cellOf(read: TeacherDashboard, labId: string, key: string): BoardCell | undefined {
  return board(read)
    .labs.find((lab) => lab.labId === labId)
    ?.cells.find((cell) => cell.key === key);
}

describe("which simulation the dashboard shows (#386)", () => {
  it("shows none when no simulation runs", async () => {
    const database = await createTestDb();
    db = database;
    const w = await world(database);
    expect(await readTeacherDashboard(database, w.teacher, READ_AT)).toEqual({ kind: "none" });
  });

  it("shows none once the running simulation is finished", async () => {
    const { database, w } = await open();
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await readTeacherDashboard(database, w.teacher, READ_AT)).toEqual({ kind: "none" });
  });

  it("tells a teacher of another simulation only that it is not theirs (D11)", async () => {
    const { database, w } = await open();
    const read = await readTeacherDashboard(database, w.outsiderTeacher, READ_AT);
    expect(read).toEqual({ kind: "not_taught" });
  });

  it("shows the board to a co-teacher, with the same rights (D10)", async () => {
    const { database, w } = await open();
    const read = board(await readTeacherDashboard(database, w.coTeacher, READ_AT));
    expect(read.simulation).toEqual({
      id: w.simulationId,
      name: "Practice simulation",
      startedAt: NOW.toISOString(),
    });
  });

  const forbidden: [string, (w: ResultsWorld) => Person][] = [
    ["a student of the simulation", (w) => w.student],
    ["a student outside it", (w) => w.outsideStudent],
    ["an administrator", (w) => w.admin],
  ];
  for (const [who, actorOf] of forbidden) {
    it(`refuses ${who} with 403 (D11, Q-SIM-1)`, async () => {
      const { database, w } = await open();
      await expect(readTeacherDashboard(database, actorOf(w), READ_AT)).rejects.toThrow(AuthError);
    });
  }
});

describe("the board (D11, G-01, G-03)", () => {
  it("has a column per sample and test of the answer model, in a stable order", async () => {
    const { database, w } = await open();
    await answer(database, w, "S-000", w.crp, "9", null);
    const read = board(await readTeacherDashboard(database, w.teacher, READ_AT));
    expect(read.columns.map((column) => [column.sampleNumber, column.testName])).toEqual([
      ["S-000", "CRP (invented)"],
      ["S-001", "CRP (invented)"],
      ["S-001", "HbA1c (invented)"],
    ]);
    expect(read.readAt).toBe(READ_AT.toISOString());
  });

  it("lists every lab of the simulation by name, and a lab with no work has no cells", async () => {
    const { database, w } = await open();
    const read = board(await readTeacherDashboard(database, w.teacher, READ_AT));
    expect(read.labs.map((lab) => lab.name)).toEqual(["Blue Cuvettes", "Pipette Pilots"]);
    const other = read.labs.find((lab) => lab.labId === w.otherLabId);
    expect(other?.cells).toEqual([]);
    expect(other?.summary).toEqual({
      green: 0,
      yellow: 0,
      red: 0,
      released: 0,
      requested: 0,
      medianTurnaroundMs: null,
    });
  });

  it("shows a requested test as open, then measured, then released with its status", async () => {
    const { database, w } = await open();
    const key = columnKey("S-001", w.hba1c);
    expect(cellOf(await readTeacherDashboard(database, w.teacher, READ_AT), w.labId, key)).toEqual(
      expect.objectContaining({ state: "open", requestId: w.requestId }),
    );
    await measure(database, w, "5.9");
    expect(
      cellOf(await readTeacherDashboard(database, w.teacher, READ_AT), w.labId, key)?.state,
    ).toBe("measured");
    await release(database, w, "5.2");
    const cell = cellOf(await readTeacherDashboard(database, w.teacher, READ_AT), w.labId, key);
    expect(cell).toMatchObject({ state: "released", value: "5.2", status: "green" });
  });

  it("takes the turnaround from the server's times of entry and release (G-01, Q-SIM-2)", async () => {
    const { database, w } = await open();
    await release(database, w, "5.6");
    const times = await database
      .selectFrom("request_tests as rt")
      .innerJoin("requests as r", "r.id", "rt.request_id")
      .select(["r.entered_at", "rt.released_at"])
      .where("rt.request_id", "=", w.requestId)
      .where("rt.test_id", "=", w.hba1c)
      .executeTakeFirstOrThrow();
    const read = await readTeacherDashboard(database, w.teacher, READ_AT);
    const cell = cellOf(read, w.labId, columnKey("S-001", w.hba1c));
    if (cell?.state !== "released" || times.released_at === null) throw new Error("not released");
    expect(cell.enteredAt).toBe(times.entered_at.toISOString());
    expect(cell.releasedAt).toBe(times.released_at.toISOString());
    expect(cell.turnaroundMs).toBe(times.released_at.getTime() - times.entered_at.getTime());
    expect(cell.status).toBe("red");
    const lab = board(read).labs.find((row) => row.labId === w.labId);
    expect(lab?.summary).toEqual({
      green: 0,
      yellow: 0,
      red: 1,
      released: 1,
      requested: 2,
      medianTurnaroundMs: cell.turnaroundMs,
    });
  });

  it("shows no status for a test without limits", async () => {
    const { database, w } = await open();
    await database.deleteFrom("simulation_test_limits").where("test_id", "=", w.hba1c).execute();
    await release(database, w, "5.0");
    const cell = cellOf(
      await readTeacherDashboard(database, w.teacher, READ_AT),
      w.labId,
      columnKey("S-001", w.hba1c),
    );
    expect(cell).toMatchObject({ state: "released", status: null });
  });

  it("matches the sample number regardless of case, and skips a request outside the model", async () => {
    const { database, w } = await open();
    const patientId = await patientIn(database, w.student, w.labId);
    await requestFor(database, w.student, w.labId, patientId, [w.crp], {
      samples: [{ sampleNumber: "S-999", material: "whole blood" }],
    });
    await sql`update samples set sample_number = 's-001' where request_id = ${w.requestId}`.execute(
      database,
    );
    const read = board(await readTeacherDashboard(database, w.teacher, READ_AT));
    const lab = read.labs.find((row) => row.labId === w.labId);
    expect(lab?.cells.map((cell) => cell.key).sort()).toEqual(
      [columnKey("S-001", w.crp), columnKey("S-001", w.hba1c)].sort(),
    );
  });

  it("takes a lab's earliest request for a sample and test", async () => {
    const { database, w } = await open();
    const patientId = await patientIn(database, w.student, w.labId);
    await requestFor(database, w.student, w.labId, patientId, [w.hba1c], {
      samples: [{ sampleNumber: "S-001", material: "whole blood" }],
    });
    const cell = cellOf(
      await readTeacherDashboard(database, w.teacher, READ_AT),
      w.labId,
      columnKey("S-001", w.hba1c),
    );
    expect(cell?.requestId).toBe(w.requestId);
  });
});

describe("tests not offered (#398)", () => {
  it("shows none while eduLIMS records none", async () => {
    const { database, w } = await open();
    const read = board(await readTeacherDashboard(database, w.teacher, READ_AT));
    expect(read.labs.map((lab) => lab.notOffered)).toEqual([null, null]);
    expect(cellOf(read, w.labId, columnKey("S-001", w.hba1c))?.notOffered).toBeNull();
  });

  it("counts them per lab and names them per request from the source", async () => {
    const { database, w } = await open();
    const source = () =>
      Promise.resolve({
        byRequest: new Map([[w.requestId, ["Ferritin (invented)"]]]),
        byLab: new Map([[w.labId, 1]]),
      });
    const read = board(await readTeacherDashboard(database, w.teacher, READ_AT, source));
    expect(read.labs.find((lab) => lab.labId === w.labId)?.notOffered).toBe(1);
    expect(read.labs.find((lab) => lab.labId === w.otherLabId)?.notOffered).toBe(0);
    expect(cellOf(read, w.labId, columnKey("S-001", w.crp))?.notOffered).toEqual([
      "Ferritin (invented)",
    ]);
  });
});
