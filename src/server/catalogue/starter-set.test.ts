// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The starter set of the catalogue (D9, Q-PRIV-4; owner 2026-11-20 on #393): the Afinion 2 tests
// on an empty catalogue only, once, with their documented units and no correct value.
import { afterEach, describe, expect, it } from "vitest";
import { AFINION_ANALYTES } from "../../lib/afinion.ts";
import { createTestDb } from "../db/test-db.ts";
import { retireTest } from "./actions.ts";
import { createTestInput } from "./schemas.ts";
import { STARTER_TESTS, seedStarterCatalogue } from "./starter-set.ts";
import { catalogueTestDb, created, events, GLUCOSE } from "./test-helpers.ts";

const setup = catalogueTestDb();

afterEach(() => setup.destroy());

describe("the starter set (#393)", () => {
  it("holds one test per Afinion 2 analyte, each a valid form with its documented unit", () => {
    expect(STARTER_TESTS.map((test) => test.analyte)).toEqual(
      AFINION_ANALYTES.map((entry) => entry.analyte),
    );
    for (const test of STARTER_TESTS) {
      const parsed = createTestInput.parse({
        name: test.name,
        unit: test.unit ?? "",
        material: test.material,
        source: "afinion",
        analyte: test.analyte,
        calculatedBy: "",
      });
      expect(parsed.source).toEqual({ kind: "afinion", analyte: test.analyte });
    }
    expect(new Set(STARTER_TESTS.map((test) => test.name.toLowerCase())).size).toBe(
      STARTER_TESTS.length,
    );
  });

  it("fills an empty catalogue and logs each test as created by the system (B4)", async () => {
    const db = await setup.database();
    expect(await seedStarterCatalogue(db)).toBe(STARTER_TESTS.length);
    const rows = await db
      .selectFrom("catalogue_tests")
      .select(["name", "unit", "source", "afinion_analyte", "retired_at", "created_by"])
      .orderBy("name")
      .execute();
    expect(rows).toHaveLength(STARTER_TESTS.length);
    expect(rows.find((row) => row.afinion_analyte === "CRP")).toMatchObject({
      unit: "mg/L",
      source: "afinion",
      retired_at: null,
      created_by: null,
    });
    expect(rows.find((row) => row.afinion_analyte === "Chol/HDL")?.unit).toBeNull();
    const log = await events(db);
    expect(log).toHaveLength(STARTER_TESTS.length);
    expect(
      log.every(
        (row) =>
          row.action === "test_created" && row.actor_type === "system" && row.actor_id === null,
      ),
    ).toBe(true);
  });

  it("adds nothing on a second run, so it is idempotent", async () => {
    const db = await setup.database();
    await seedStarterCatalogue(db);
    expect(await seedStarterCatalogue(db)).toBe(0);
    const count = await db
      .selectFrom("catalogue_tests")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(STARTER_TESTS.length);
  });

  it("leaves a catalogue alone that holds any test, a retired one too", async () => {
    const ctx = await setup.admin();
    const id = await created(ctx, GLUCOSE);
    await retireTest(ctx, { testId: id });
    expect(await seedStarterCatalogue(ctx.db)).toBe(0);
  });

  it("writes no correct value (Q-PRIV-4)", async () => {
    const db = await createTestDb();
    try {
      await seedStarterCatalogue(db);
      const values = await db
        .selectFrom("correct_values")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .executeTakeFirstOrThrow();
      expect(Number(values.n)).toBe(0);
    } finally {
      await db.destroy();
    }
  });
});
