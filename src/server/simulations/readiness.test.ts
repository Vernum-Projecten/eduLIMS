// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The overview's read of a simulation's preparation (D10, D11, #381): the counts per step, the
// tests that block the start, and the start's verdict from the rule the start applies; nobody
// but a teacher of the simulation reads any of it.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { setCorrectValues, setLimits } from "../correct-values/actions.ts";
import {
  catalogueTest,
  SECRET_VALUE,
  SECRET_YELLOW,
  seedSecrets,
} from "../correct-values/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { getSimulationReadiness } from "./readiness.ts";
import { finishSimulation, type StartFacts, startRefusal, startSimulation } from "./state.ts";
import {
  NOW,
  notFoundLine,
  type Person,
  person,
  securityLines,
  startable,
  type World,
  world,
} from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

async function valueFor(database: Kysely<DB>, w: World, testId: string, sampleNumber: string) {
  const set = await setCorrectValues(
    database,
    w.teacher,
    { simulationId: w.simulationId, rows: [{ sampleNumber, testId, value: "5.5" }] },
    NOW,
  );
  if (!set.ok) throw new Error(set.error);
}

describe("startRefusal (#267, #381, #386, #394)", () => {
  const ready = {
    state: "prepared",
    students: 1,
    correctValues: 1,
    missingLimits: [],
    anotherRunning: false,
  } satisfies StartFacts;

  it("allows a prepared simulation with a student, a correct value and every limit set", () => {
    expect(startRefusal(ready)).toBeNull();
  });

  it("refuses a simulation without a student in any lab (no_students)", () => {
    expect(startRefusal({ ...ready, students: 0 })).toEqual({ error: "no_students" });
  });

  it("refuses a simulation without a correct value (no_correct_values)", () => {
    expect(startRefusal({ ...ready, correctValues: 0 })).toEqual({ error: "no_correct_values" });
  });

  it("refuses a prepared simulation with a test without limits, naming the test", () => {
    expect(startRefusal({ ...ready, missingLimits: ["t-1"] })).toEqual({
      error: "missing_limits",
      testIds: ["t-1"],
    });
  });

  it("refuses a prepared simulation while another runs, before every other reason (#386)", () => {
    expect(startRefusal({ ...ready, anotherRunning: true })).toEqual({
      error: "another_running",
    });
    const empty = { ...ready, students: 0, correctValues: 0, missingLimits: ["t-1"] };
    expect(startRefusal({ ...empty, anotherRunning: true })).toEqual({
      error: "another_running",
    });
  });

  it("names the students before the values, and the values before the limits", () => {
    const empty = { ...ready, students: 0, correctValues: 0, missingLimits: ["t-1"] };
    expect(startRefusal(empty)?.error).toBe("no_students");
    expect(startRefusal({ ...empty, students: 2 })?.error).toBe("no_correct_values");
  });

  it.each(["running", "finished"] as const)("refuses a %s simulation as not prepared", (state) => {
    expect(startRefusal({ ...ready, state, students: 0, anotherRunning: true })).toEqual({
      error: "not_prepared",
    });
  });
});

describe("getSimulationReadiness (D10, #381)", () => {
  it("counts the labs, the empty labs, the students and the waiting addresses", async () => {
    const { database, w } = await open();
    await database
      .insertInto("labs")
      .values({ simulation_id: w.simulationId, name: "Empty Flask" })
      .execute();
    await database
      .insertInto("lab_member_emails")
      .values({ simulation_id: w.simulationId, lab_id: w.otherLabId, email: "waits@example.test" })
      .execute();
    const readiness = await getSimulationReadiness(database, w.teacher, w.simulationId);
    expect(readiness?.labs).toEqual({ count: 3, empty: 1, students: 7, waiting: 1 });
  });

  it("refuses the start of a new simulation without values, as the start does", async () => {
    const { database, w } = await open();
    const readiness = await getSimulationReadiness(database, w.teacher, w.simulationId);
    expect(readiness).toMatchObject({
      simulationId: w.simulationId,
      state: "prepared",
      startedAt: null,
      finishedAt: null,
      values: { count: 0, tests: 0 },
      missingLimits: [],
      startRefusal: { error: "no_correct_values" },
    });
    const start = await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(start).toEqual({ ok: false, error: "no_correct_values" });
  });

  it("refuses the start of a simulation whose labs have no student, as the start does", async () => {
    const { database, w } = await open();
    const simulationId = w.outsideSimulationId;
    await database.deleteFrom("lab_members").where("simulation_id", "=", simulationId).execute();
    await startable(database, simulationId);
    const readiness = await getSimulationReadiness(database, w.outsiderTeacher, simulationId);
    expect(readiness?.labs).toMatchObject({ count: 1, empty: 1, students: 0 });
    expect(readiness?.startRefusal).toEqual({ error: "no_students" });
    const start = await startSimulation(database, w.outsiderTeacher, { simulationId }, NOW);
    expect(start).toEqual({ ok: false, error: "no_students" });
  });

  it("names the tests without limits and refuses as the start refuses (missing_limits)", async () => {
    const { database, w } = await open();
    const glucose = await catalogueTest(database, "Glucose (invented)");
    const albumin = await catalogueTest(database, "Albumin (invented)");
    await valueFor(database, w, glucose, "S-001");
    await valueFor(database, w, glucose, "S-002");
    await valueFor(database, w, albumin, "S-001");
    const readiness = await getSimulationReadiness(database, w.coTeacher, w.simulationId);
    expect(readiness?.values).toEqual({ count: 3, tests: 2 });
    expect(readiness?.missingLimits).toEqual([
      { id: albumin, name: "Albumin (invented)" },
      { id: glucose, name: "Glucose (invented)" },
    ]);
    const start = await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(start).toMatchObject({ ok: false, error: readiness?.startRefusal?.error });
    expect(readiness?.startRefusal).toEqual({
      error: "missing_limits",
      testIds: [albumin, glucose].sort(),
    });
  });

  it("allows the start once every test has its limits, and the start then succeeds", async () => {
    const { database, w } = await open();
    await seedSecrets(database, w);
    const other = await catalogueTest(database, "Albumin (invented)");
    await valueFor(database, w, other, "S-003");
    const limits = await setLimits(
      database,
      w.teacher,
      { simulationId: w.simulationId, testId: other, kind: "percent", yellow: "5", red: "10" },
      NOW,
    );
    if (!limits.ok) throw new Error(limits.error);
    const readiness = await getSimulationReadiness(database, w.teacher, w.simulationId);
    expect(readiness).toMatchObject({ missingLimits: [], startRefusal: null });
    expect(readiness?.values.tests).toBe(2);
    expect(JSON.stringify(readiness)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(readiness)).not.toContain(SECRET_YELLOW);
    const start = await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(start.ok).toBe(true);
  });

  it("refuses the start of a running and of a finished simulation as not prepared", async () => {
    const { database, w } = await open();
    const input = { simulationId: w.simulationId };
    await startable(database, w.simulationId);
    expect((await startSimulation(database, w.teacher, input, NOW)).ok).toBe(true);
    const running = await getSimulationReadiness(database, w.teacher, w.simulationId);
    expect(running).toMatchObject({
      state: "running",
      startedAt: NOW.toISOString(),
      startRefusal: { error: "not_prepared" },
    });
    await finishSimulation(database, w.teacher, input, NOW);
    const finished = await getSimulationReadiness(database, w.teacher, w.simulationId);
    expect(finished).toMatchObject({
      state: "finished",
      finishedAt: NOW.toISOString(),
      startRefusal: { error: "not_prepared" },
    });
  });

  it("shows another_running while another teacher's simulation runs, naming none (#386)", async () => {
    const { database, w } = await open();
    await startable(database, w.outsideSimulationId);
    const other = await startSimulation(
      database,
      w.outsiderTeacher,
      { simulationId: w.outsideSimulationId },
      NOW,
    );
    expect(other.ok).toBe(true);
    const readiness = await getSimulationReadiness(database, w.teacher, w.simulationId);
    expect(readiness?.startRefusal).toEqual({ error: "another_running" });
    expect(JSON.stringify(readiness)).not.toContain(w.outsideSimulationId);
    expect(JSON.stringify(readiness)).not.toContain("Other simulation");
  });

  const forbidden: [string, (w: World) => Person][] = [
    ["a student of the simulation", (w) => w.student],
    ["a student outside it", (w) => w.outsideStudent],
    ["an administrator", (w) => w.admin],
  ];
  for (const [who, actorOf] of forbidden) {
    it(`refuses ${who} with 403 (D11, Q-SIM-1)`, async () => {
      const { database, w } = await open();
      const error = await getSimulationReadiness(database, actorOf(w), w.simulationId).then(
        () => null,
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ status: 403 });
    });
  }

  it("reads nothing for a teacher of another simulation, and logs the probe (D11)", async () => {
    const { database, w } = await open();
    let readiness: unknown;
    const lines = await securityLines(async () => {
      readiness = await getSimulationReadiness(database, w.outsiderTeacher, w.simulationId);
    });
    expect(readiness).toBeNull();
    expect(lines).toEqual([notFoundLine(w.outsiderTeacher.id, "simulation", w.simulationId)]);
  });

  it("reads nothing for a co-teacher removed from the simulation, and logs the probe", async () => {
    const { database, w } = await open();
    await database
      .deleteFrom("simulation_teachers")
      .where("simulation_id", "=", w.simulationId)
      .where("user_id", "=", w.coTeacher.id)
      .execute();
    let readiness: unknown;
    const lines = await securityLines(async () => {
      readiness = await getSimulationReadiness(database, w.coTeacher, w.simulationId);
    });
    expect(readiness).toBeNull();
    expect(lines).toEqual([notFoundLine(w.coTeacher.id, "simulation", w.simulationId)]);
  });

  it("refuses a former teacher whose row stayed but whose app role is now student", async () => {
    const { database, w } = await open();
    const former = await person(database, "former-teacher", ["student"]);
    await database
      .insertInto("simulation_teachers")
      .values({ simulation_id: w.simulationId, user_id: former.id, added_by: w.teacher.id })
      .execute();
    await expect(getSimulationReadiness(database, former, w.simulationId)).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("reads nothing for a malformed id, and logs it", async () => {
    const { database, w } = await open();
    let readiness: unknown;
    const lines = await securityLines(async () => {
      readiness = await getSimulationReadiness(database, w.teacher, "not-a-uuid");
    });
    expect(readiness).toBeNull();
    expect(lines).toEqual([notFoundLine(w.teacher.id, "simulation", "not-a-uuid")]);
  });
});
