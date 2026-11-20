// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
// Parallel writes on a committed database (D9, #266): the names of active tests and the analyte
// names of active Afinion 2 tests stay unique regardless of case under concurrent transactions,
// and a race ends in a refusal with its activity-log row, never in an error (a 500).
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { person } from "../simulations/test-helpers.ts";
import { createTest, restoreTest, retireTest, type TestActionContext } from "./actions.ts";
import type { TestDefinition } from "./schemas.ts";
import { STARTER_TESTS, seedStarterCatalogue } from "./starter-set.ts";

let committed: CommittedTestDb | undefined;

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
});

const NOW = new Date("2026-11-19T09:00:00Z");

async function open(): Promise<{ db: Kysely<DB>; ctx: TestActionContext }> {
  committed = await createCommittedTestDb(12);
  const { db } = committed;
  const actor = await person(db, "racing-admin", ["admin"]);
  return { db, ctx: { db, actor, now: NOW } };
}

function manual(name: string): TestDefinition {
  return { name, unit: "mmol/L", material: "serum", source: { kind: "manual" } };
}

function afinion(name: string, analyte: string): TestDefinition {
  return { name, unit: "mg/L", material: "blood", source: { kind: "afinion", analyte } };
}

function outcomes(db: Kysely<DB>, action: "test_created" | "test_restored") {
  return db
    .selectFrom("audit_event")
    .select(["outcome", "reason_code"])
    .where("action", "=", action)
    .orderBy("outcome")
    .execute();
}

describe("parallel writes (D9, #266)", () => {
  it("lets one of ten parallel creates of one name through, whatever its case", async () => {
    const { db, ctx } = await open();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        createTest(ctx, manual(index % 2 === 0 ? "Cholesterol" : "CHOLESTEROL")),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 9 }, () => ({ ok: false, error: "name_taken" })),
    );
    expect(await db.selectFrom("catalogue_tests").select("id").execute()).toHaveLength(1);
    const logged = await outcomes(db, "test_created");
    expect(logged.filter((row) => row.outcome === "success")).toHaveLength(1);
    expect(logged.filter((row) => row.outcome === "refused")).toHaveLength(9);
  });

  it("lets one of ten parallel creates of one analyte through, under different names", async () => {
    const { db, ctx } = await open();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        createTest(ctx, afinion(`CRP ${index}`, index % 2 === 0 ? "CRP" : "crp")),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 9 }, () => ({ ok: false, error: "analyte_taken" })),
    );
    expect(await db.selectFrom("catalogue_tests").select("id").execute()).toHaveLength(1);
  });

  it("refuses one of a restore and a create of the same name, never failing", async () => {
    const { ctx } = await open();
    const old = await createTest(ctx, manual("Urea"));
    if (!old.ok) throw new Error(old.error);
    await retireTest(ctx, { testId: old.testId });
    const [restored, created] = await Promise.all([
      restoreTest(ctx, { testId: old.testId }),
      createTest(ctx, manual("UREA")),
    ]);
    expect([restored, created].filter((result) => result.ok)).toHaveLength(1);
    expect([restored, created].filter((result) => !result.ok)).toEqual([
      { ok: false, error: "name_taken" },
    ]);
  });

  it("refuses one of a restore and a create of the same analyte, never failing", async () => {
    const { ctx } = await open();
    const old = await createTest(ctx, afinion("HbA1c", "HbA1c"));
    if (!old.ok) throw new Error(old.error);
    await retireTest(ctx, { testId: old.testId });
    const [restored, created] = await Promise.all([
      restoreTest(ctx, { testId: old.testId }),
      createTest(ctx, afinion("HbA1c (new)", "HBA1C")),
    ]);
    expect([restored, created].filter((result) => result.ok)).toHaveLength(1);
    expect([restored, created].filter((result) => !result.ok)).toEqual([
      { ok: false, error: "analyte_taken" },
    ]);
  });
});

describe("the starter set on two connections at once (#393; #404 review, F3)", () => {
  it("is added once: one set of tests and one log row each", async () => {
    committed = await createCommittedTestDb(4);
    const { db } = committed;
    const added = await Promise.all([seedStarterCatalogue(db), seedStarterCatalogue(db)]);
    expect([...added].sort((a, b) => a - b)).toEqual([0, STARTER_TESTS.length]);
    expect(await db.selectFrom("catalogue_tests").select("id").execute()).toHaveLength(
      STARTER_TESTS.length,
    );
    const log = await db
      .selectFrom("audit_event")
      .select("actor_type")
      .where("action", "=", "test_created")
      .execute();
    expect(log).toEqual(STARTER_TESTS.map(() => ({ actor_type: "system" })));
  });
});
