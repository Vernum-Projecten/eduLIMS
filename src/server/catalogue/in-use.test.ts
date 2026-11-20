// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { parseCatalogueTestId } from "../../lib/catalogue.ts";
import { seedSecrets } from "../correct-values/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { patientIn, recordsWorld, requestFor } from "../lab-records/test-helpers.ts";
import { finishSimulation, startSimulation } from "../simulations/state.ts";
import { NOW, world } from "../simulations/test-helpers.ts";
import { updateTest } from "./actions.ts";
import { testUsage, usageOf } from "./in-use.ts";
import { readTestPage } from "./reads.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe("a test in use (D9, #266)", () => {
  it("is no test while no simulation refers to the catalogue (#267, #268)", async () => {
    db = await createTestDb();
    const row = await db
      .insertInto("catalogue_tests")
      .values({
        name: "HbA1c",
        unit: "%",
        material: "blood",
        source: "afinion",
        afinion_analyte: "HbA1c",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const id = parseCatalogueTestId(row.id);
    if (id === null) throw new Error("catalogue_tests.id is not a UUID");
    expect(await usageOf(db, id)).toBe("unused");
    expect([...(await testUsage(db, [id]))]).toEqual([]);
    expect([...(await testUsage(db, []))]).toEqual([]);
  });
});

describe("a test a simulation's correct values name (D9, D10, #267)", () => {
  async function used() {
    const database = await createTestDb();
    db = database;
    const w = await world(database);
    const testId = parseCatalogueTestId(await seedSecrets(database, w));
    if (testId === null) throw new Error("catalogue_tests.id is not a UUID");
    return { database, w, testId };
  }

  it("is used while its simulation is prepared", async () => {
    const { database, testId } = await used();
    expect(await usageOf(database, testId)).toBe("used");
  });

  it("is running while its simulation runs, and used again once it is finished", async () => {
    const { database, w, testId } = await used();
    await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await usageOf(database, testId)).toBe("running");
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await usageOf(database, testId)).toBe("used");
  });

  it("refuses a unit change once used, and a material change while running (D9)", async () => {
    const { database, w, testId } = await used();
    const ctx = { db: database, actor: w.teacher, now: NOW };
    const test = {
      name: "Glucose (invented)",
      unit: "mmol/L",
      material: "plasma",
      source: { kind: "manual" } as const,
    };
    expect(await updateTest(ctx, { testId, test: { ...test, unit: "mg/dL" } })).toEqual({
      ok: false,
      error: "in_use",
    });
    expect(await updateTest(ctx, { testId, test: { ...test, material: "serum" } })).toEqual({
      ok: true,
      testId,
    });
    await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await updateTest(ctx, { testId, test: { ...test, material: "blood" } })).toEqual({
      ok: false,
      error: "in_running_simulation",
    });
  });

  it("is listed with its usage in the catalogue", async () => {
    const { database, w, testId } = await used();
    const page = await readTestPage({ db: database, actor: w.teacher }, {});
    expect(page.rows.find((row) => row.id === testId)?.usage).toBe("used");
  });
});

describe("a test a lab's request names (D9, S12, #268)", () => {
  async function requested() {
    const database = await createTestDb();
    db = database;
    const w = await recordsWorld(database);
    const patientId = await patientIn(database, w.student, w.labId);
    await requestFor(database, w.student, w.labId, patientId, [w.crp]);
    const testId = parseCatalogueTestId(w.crp);
    if (testId === null) throw new Error("catalogue_tests.id is not a UUID");
    return { database, w, testId };
  }

  it("is running while the request's simulation runs, with no correct value for it", async () => {
    const { database, testId } = await requested();
    expect(await usageOf(database, testId)).toBe("running");
  });

  it("is used once the request's simulation is finished", async () => {
    const { database, w, testId } = await requested();
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await usageOf(database, testId)).toBe("used");
  });

  it("leaves a test that no request and no value names unused", async () => {
    const { database, w } = await requested();
    const hba1c = parseCatalogueTestId(w.hba1c);
    if (hba1c === null) throw new Error("catalogue_tests.id is not a UUID");
    expect(await usageOf(database, hba1c)).toBe("unused");
  });
});
