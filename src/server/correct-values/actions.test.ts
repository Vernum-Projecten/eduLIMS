// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Writing correct values and limits (D10, D13, #267) on a real database: keyed by simulation,
// sample number and test, never by a lab; changeable in every state; every change logged with
// ids only, never the value (B4, E4); and refused to everyone but a teacher of the simulation.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { createLab, deleteLab } from "../simulations/labs.ts";
import { finishSimulation, startSimulation } from "../simulations/state.ts";
import { teacherWriteRefusals } from "../simulations/test-access.ts";
import { auditRows, NOW, securityLines, type World, world } from "../simulations/test-helpers.ts";
import { removeCorrectValue, setCorrectValues, setLimits } from "./actions.ts";
import {
  catalogueTest,
  SECRET_RED,
  SECRET_VALUE,
  SECRET_YELLOW,
  seedSecrets,
} from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  const w = await world(db);
  const testId = await catalogueTest(db, "Urea (invented)");
  return { db, w, testId };
}

function values(database: Kysely<DB>, simulationId: string) {
  return database
    .selectFrom("correct_values")
    .select(["sample_number", "test_id", "value"])
    .where("simulation_id", "=", simulationId)
    .orderBy("sample_number")
    .execute();
}

function set(
  database: Kysely<DB>,
  w: World,
  rows: { sampleNumber: string; testId: string; value: string }[],
) {
  return setCorrectValues(database, w.teacher, { simulationId: w.simulationId, rows }, NOW);
}

describe("setting correct values (D10)", () => {
  it("adds a value per sample number and test, and reports what it added", async () => {
    const { db: database, w, testId } = await open();
    const result = await set(database, w, [
      { sampleNumber: "S-001", testId, value: "5.2" },
      { sampleNumber: "S-002", testId, value: "-0.75" },
    ]);
    expect(result).toEqual({ ok: true, value: { added: 2, changed: 0, unchanged: 0 } });
    expect(await values(database, w.simulationId)).toEqual([
      { sample_number: "S-001", test_id: testId, value: "5.2" },
      { sample_number: "S-002", test_id: testId, value: "-0.75" },
    ]);
  });

  it("keeps the digits as typed: no float rounding of 0.1 + 0.2 style values", async () => {
    const { db: database, w, testId } = await open();
    await set(database, w, [{ sampleNumber: "S-001", testId, value: "0.300000" }]);
    await set(database, w, [{ sampleNumber: "S-002", testId, value: "123456789.123456" }]);
    expect((await values(database, w.simulationId)).map((row) => row.value)).toEqual([
      "0.300000",
      "123456789.123456",
    ]);
  });

  it("changes a known value, matching the sample number regardless of case (D10)", async () => {
    const { db: database, w, testId } = await open();
    await set(database, w, [{ sampleNumber: "S-001", testId, value: "5.2" }]);
    const result = await set(database, w, [{ sampleNumber: "s-001", testId, value: "5.4" }]);
    expect(result).toEqual({ ok: true, value: { added: 0, changed: 1, unchanged: 0 } });
    expect(await values(database, w.simulationId)).toEqual([
      { sample_number: "S-001", test_id: testId, value: "5.4" },
    ]);
  });

  it("writes nothing for an unchanged value", async () => {
    const { db: database, w, testId } = await open();
    await set(database, w, [{ sampleNumber: "S-001", testId, value: "5.2" }]);
    const before = await auditRows(database, "simulation_value_changed");
    const result = await set(database, w, [{ sampleNumber: "S-001", testId, value: "5.2" }]);
    expect(result).toEqual({ ok: true, value: { added: 0, changed: 0, unchanged: 1 } });
    expect(await auditRows(database, "simulation_value_changed")).toEqual(before);
  });

  it("is changeable before, during and after the simulation (D10)", async () => {
    const { db: database, w, testId } = await open();
    await set(database, w, [{ sampleNumber: "S-001", testId, value: "1" }]);
    const limits = {
      simulationId: w.simulationId,
      testId,
      kind: "percent",
      yellow: "5",
      red: "10",
    };
    await setLimits(database, w.teacher, { ...limits, kind: "percent" }, NOW);
    expect(
      await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW),
    ).toEqual({ ok: true, value: null });
    expect((await set(database, w, [{ sampleNumber: "S-001", testId, value: "2" }])).ok).toBe(true);
    expect(
      await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW),
    ).toEqual({ ok: true, value: null });
    expect((await set(database, w, [{ sampleNumber: "S-001", testId, value: "3" }])).ok).toBe(true);
    expect((await values(database, w.simulationId)).map((row) => row.value)).toEqual(["3"]);
  });

  it("holds for every lab: adding or removing a lab changes no value (D10)", async () => {
    const { db: database, w, testId } = await open();
    await set(database, w, [{ sampleNumber: "S-001", testId, value: "5.2" }]);
    const before = await values(database, w.simulationId);
    const lab = await createLab(
      database,
      w.teacher,
      { simulationId: w.simulationId, name: "Late Lab" },
      NOW,
    );
    if (!lab.ok) throw new Error(lab.error);
    expect(await values(database, w.simulationId)).toEqual(before);
    await deleteLab(database, w.teacher, { labId: lab.value.labId });
    expect(await values(database, w.simulationId)).toEqual(before);
  });

  it("lets a co-teacher change a value, with the same rights (D10)", async () => {
    const { db: database, w, testId } = await open();
    await set(database, w, [{ sampleNumber: "S-001", testId, value: "5.2" }]);
    const result = await setCorrectValues(
      database,
      w.coTeacher,
      { simulationId: w.simulationId, rows: [{ sampleNumber: "S-001", testId, value: "6" }] },
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it("logs ids only: the test and the value's id, never the value or the sample number (E4)", async () => {
    const { db: database, w, testId } = await open();
    let lines: Record<string, unknown>[] = [];
    lines = await securityLines(async () => {
      await set(database, w, [{ sampleNumber: "S-777", testId, value: SECRET_VALUE }]);
      await set(database, w, [{ sampleNumber: "S-777", testId, value: SECRET_RED }]);
    });
    const [stored] = await database.selectFrom("correct_values").select("id").execute();
    const expected = {
      actor_id: w.teacher.id,
      outcome: "success",
      target_type: "simulation",
      target_id: w.simulationId,
      reason_code: null,
      metadata: { test_id: testId, correct_value_id: stored?.id },
    };
    expect(await auditRows(database, "simulation_value_set")).toEqual([expected]);
    expect(await auditRows(database, "simulation_value_changed")).toEqual([expected]);
    const logged = JSON.stringify([lines, await auditRows(database, "simulation_value_set")]);
    for (const needle of ["987654", "8.8765", "8,8765", "S-777"]) {
      expect(logged).not.toContain(needle);
    }
  });

  it("refuses a test that is not in the catalogue and stores nothing", async () => {
    const { db: database, w } = await open();
    const unknown = "01900000-0000-7000-8000-000000000000";
    const result = await set(database, w, [{ sampleNumber: "S-001", testId: unknown, value: "1" }]);
    expect(result).toEqual({ ok: false, error: "test_not_found" });
    expect(await values(database, w.simulationId)).toEqual([]);
    expect(await auditRows(database, "simulation_value_set")).toEqual([
      expect.objectContaining({ outcome: "refused", reason_code: "test_not_found" }),
    ]);
  });

  it("refuses a retired test the simulation does not use yet (D9)", async () => {
    const { db: database, w } = await open();
    const retired = await catalogueTest(database, "Old test (invented)", { retired: true });
    const result = await set(database, w, [{ sampleNumber: "S-001", testId: retired, value: "1" }]);
    expect(result).toEqual({ ok: false, error: "test_retired" });
  });

  it("keeps a retired test's values changeable once the simulation uses it", async () => {
    const { db: database, w, testId } = await open();
    await set(database, w, [{ sampleNumber: "S-001", testId, value: "1" }]);
    await database
      .updateTable("catalogue_tests")
      .set({ retired_at: NOW })
      .where("id", "=", testId)
      .execute();
    const result = await set(database, w, [
      { sampleNumber: "S-001", testId, value: "2" },
      { sampleNumber: "S-002", testId, value: "3" },
    ]);
    expect(result).toEqual({ ok: true, value: { added: 1, changed: 1, unchanged: 0 } });
  });

  it("is refused by the database for a sample number with a control character", async () => {
    const { db: database, w, testId } = await open();
    await expect(
      database
        .insertInto("correct_values")
        .values({
          simulation_id: w.simulationId,
          test_id: testId,
          sample_number: "S\u0007",
          value: "1",
        })
        .execute(),
    ).rejects.toThrow(/correct_values_sample_number/);
  });

  teacherWriteRefusals({
    call: async (database, _w, actor, target) => {
      const testId = await catalogueTest(database, `Probe ${actor.id}`);
      return setCorrectValues(
        database,
        actor,
        { simulationId: target, rows: [{ sampleNumber: "S-009", testId, value: "1" }] },
        NOW,
      );
    },
    target: (w) => ({ type: "simulation", id: w.simulationId }),
  });
});

describe("removing a correct value (D10)", () => {
  it("removes it and logs its id", async () => {
    const { db: database, w } = await open();
    const testId = await seedSecrets(database, w);
    const [row] = await database.selectFrom("correct_values").select("id").execute();
    if (!row) throw new Error("no value");
    expect(
      await removeCorrectValue(database, w.teacher, {
        simulationId: w.simulationId,
        correctValueId: row.id,
      }),
    ).toEqual({ ok: true, value: null });
    expect(await values(database, w.simulationId)).toEqual([]);
    expect(await auditRows(database, "simulation_value_removed")).toEqual([
      expect.objectContaining({ metadata: { test_id: testId, correct_value_id: row.id } }),
    ]);
  });

  it("answers value_not_found for a value of another simulation", async () => {
    const { db: database, w } = await open();
    await seedSecrets(database, w);
    const [row] = await database.selectFrom("correct_values").select("id").execute();
    if (!row) throw new Error("no value");
    const result = await removeCorrectValue(database, w.outsiderTeacher, {
      simulationId: w.outsideSimulationId,
      correctValueId: row.id,
    });
    expect(result).toEqual({ ok: false, error: "value_not_found" });
    expect(await values(database, w.simulationId)).toHaveLength(1);
  });

  teacherWriteRefusals({
    prepare: async (database, w) => {
      await seedSecrets(database, w);
    },
    call: async (database, _w, actor, target) => {
      const [row] = await database.selectFrom("correct_values").select("id").execute();
      return removeCorrectValue(database, actor, {
        simulationId: target,
        correctValueId: row?.id ?? "",
      });
    },
    target: (w) => ({ type: "simulation", id: w.simulationId }),
  });
});

describe("setting accuracy limits (D13)", () => {
  it("stores the kind and both limits, and replaces them on a second save", async () => {
    const { db: database, w, testId } = await open();
    const input = {
      simulationId: w.simulationId,
      testId,
      kind: "percent" as const,
      yellow: "5",
      red: "10",
    };
    expect(await setLimits(database, w.teacher, input, NOW)).toEqual({ ok: true, value: null });
    await setLimits(
      database,
      w.teacher,
      { ...input, kind: "absolute", yellow: SECRET_YELLOW, red: SECRET_RED },
      NOW,
    );
    const rows = await database
      .selectFrom("simulation_test_limits")
      .select(["kind", "yellow_limit", "red_limit"])
      .execute();
    expect(rows).toEqual([
      { kind: "absolute", yellow_limit: SECRET_YELLOW, red_limit: SECRET_RED },
    ]);
    expect(await auditRows(database, "simulation_limits_set")).toEqual([
      expect.objectContaining({ metadata: { test_id: testId } }),
      expect.objectContaining({ metadata: { test_id: testId } }),
    ]);
  });

  it("refuses an unknown test", async () => {
    const { db: database, w } = await open();
    const result = await setLimits(
      database,
      w.teacher,
      {
        simulationId: w.simulationId,
        testId: "01900000-0000-7000-8000-000000000000",
        kind: "percent",
        yellow: "1",
        red: "2",
      },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "test_not_found" });
  });

  it("is refused by the database when red is closer than yellow (D13)", async () => {
    const { db: database, w, testId } = await open();
    await expect(
      database
        .insertInto("simulation_test_limits")
        .values({
          simulation_id: w.simulationId,
          test_id: testId,
          kind: "percent",
          yellow_limit: "5",
          red_limit: "4",
        })
        .execute(),
    ).rejects.toThrow(/simulation_test_limits_values/);
  });

  teacherWriteRefusals({
    call: async (database, _w, actor, target) => {
      const testId = await catalogueTest(database, `Probe ${actor.id}`);
      return setLimits(
        database,
        actor,
        { simulationId: target, testId, kind: "percent", yellow: "1", red: "2" },
        NOW,
      );
    },
    target: (w) => ({ type: "simulation", id: w.simulationId }),
  });
});
