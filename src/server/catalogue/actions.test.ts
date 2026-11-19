// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The changes to the test catalogue (D9, S4, #266) on a real database: the rules of a test, the
// activity-log rows with ids only (B4), and the refusal of every role but teacher (A01).
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogueTestId } from "../../lib/catalogue.ts";
import type { Role } from "../../lib/roles.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { person } from "../simulations/test-helpers.ts";
import {
  createTest,
  isNameTaken,
  restoreTest,
  retireTest,
  type TestActionContext,
  updateTest,
} from "./actions.ts";
import { readTestPage } from "./reads.ts";
import type { TestDefinition } from "./schemas.ts";

const used = vi.hoisted(() => new Set<string>());
vi.mock("./in-use.ts", () => ({
  isTestInUse: (_db: unknown, id: string) => Promise.resolve(used.has(id)),
  testsInUse: (_db: unknown, ids: readonly string[]) =>
    Promise.resolve(new Set(ids.filter((id) => used.has(id)))),
}));

const NOW = new Date("2026-11-19T09:00:00Z");
const LATER = new Date("2026-11-19T10:00:00Z");
const UNKNOWN = "01900000-0000-7000-8000-000000000000";

let db: Kysely<DB> | undefined;

beforeEach(() => used.clear());

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function teacher(key = "teacher", roles: readonly Role[] = ["teacher"], now = NOW) {
  db ??= await createTestDb();
  // The user table refuses an empty role set, so a caller without a role is a session user only.
  const actor = roles.length === 0 ? { id: key, roles } : await person(db, key, roles);
  return { db, actor, now } satisfies TestActionContext;
}

const CRP: TestDefinition = {
  name: "CRP",
  unit: "mg/L",
  material: "blood",
  source: { kind: "afinion", analyte: "CRP" },
};

const GLUCOSE: TestDefinition = {
  name: "Glucose",
  unit: "mmol/L",
  material: "plasma",
  source: { kind: "epoch_upload", calculatedBy: "team" },
};

function events(database: Kysely<DB>) {
  return database
    .selectFrom("audit_event")
    .select(["action", "actor_id", "target_type", "target_id", "outcome", "metadata"])
    .where("action", "like", "test_%")
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();
}

function stored(database: Kysely<DB>, id: string) {
  return database
    .selectFrom("catalogue_tests")
    .select([
      "name",
      "unit",
      "material",
      "source",
      "afinion_analyte",
      "epoch_calculated_by",
      "created_by",
      "updated_at",
      "retired_at",
    ])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

async function created(ctx: TestActionContext, input = CRP): Promise<CatalogueTestId> {
  const result = await createTest(ctx, input);
  if (!result.ok) throw new Error(`create refused: ${result.error}`);
  return result.testId;
}

describe("createTest (D9)", () => {
  it("adds a test with its name, unit and material and logs test_created with ids only", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    expect(await stored(ctx.db, id)).toEqual({
      name: "CRP",
      unit: "mg/L",
      material: "blood",
      source: "afinion",
      afinion_analyte: "CRP",
      epoch_calculated_by: null,
      created_by: ctx.actor.id,
      updated_at: NOW,
      retired_at: null,
    });
    expect(await events(ctx.db)).toEqual([
      {
        action: "test_created",
        actor_id: ctx.actor.id,
        target_type: "test",
        target_id: id,
        outcome: "success",
        metadata: null,
      },
    ]);
  });

  it("stores who calculates an Epoch 2 concentration, and nothing of an analyte (D9, S4)", async () => {
    const ctx = await teacher();
    const id = await created(ctx, GLUCOSE);
    expect(await stored(ctx.db, id)).toMatchObject({
      source: "epoch_upload",
      afinion_analyte: null,
      epoch_calculated_by: "team",
    });
  });

  it("stores a test entered by hand without a setting (O8)", async () => {
    const ctx = await teacher();
    const id = await created(ctx, {
      name: "LDL (calculated)",
      unit: "mmol/L",
      material: "serum",
      source: { kind: "manual" },
    });
    expect(await stored(ctx.db, id)).toMatchObject({
      source: "manual",
      afinion_analyte: null,
      epoch_calculated_by: null,
    });
  });

  it("refuses a name an active test holds, compared case-insensitively", async () => {
    const ctx = await teacher();
    await created(ctx);
    expect(await createTest(ctx, { ...CRP, name: "crp" })).toEqual({
      ok: false,
      error: "name_taken",
    });
    expect(await events(ctx.db)).toHaveLength(1);
  });

  it("accepts the name of a retired test", async () => {
    const ctx = await teacher();
    const old = await created(ctx);
    await retireTest(ctx, { testId: old });
    expect((await createTest(ctx, CRP)).ok).toBe(true);
  });
});

describe("updateTest (D9)", () => {
  it("lets any teacher change any test, and logs the names of the changed settings", async () => {
    const owner = await teacher();
    const id = await created(owner, GLUCOSE);
    const other = await teacher("other-teacher", ["teacher"], LATER);
    const result = await updateTest(other, {
      testId: id,
      test: {
        ...GLUCOSE,
        material: "serum",
        source: { kind: "epoch_upload", calculatedBy: "edulims" },
      },
    });
    expect(result).toEqual({ ok: true, testId: id });
    expect(await stored(owner.db, id)).toMatchObject({
      material: "serum",
      epoch_calculated_by: "edulims",
      created_by: owner.actor.id,
      updated_at: LATER,
    });
    expect((await events(owner.db)).at(-1)).toEqual({
      action: "test_changed",
      actor_id: other.actor.id,
      target_type: "test",
      target_id: id,
      outcome: "success",
      metadata: { fields: ["material", "calculated_by"] },
    });
  });

  it("drops the setting of the old source when the source changes", async () => {
    const ctx = await teacher();
    const id = await created(ctx, GLUCOSE);
    await updateTest(ctx, { testId: id, test: { ...GLUCOSE, source: { kind: "manual" } } });
    expect(await stored(ctx.db, id)).toMatchObject({
      source: "manual",
      epoch_calculated_by: null,
    });
  });

  it("writes nothing and logs nothing when nothing changed", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    expect(await updateTest(ctx, { testId: id, test: CRP })).toEqual({ ok: true, testId: id });
    expect(await events(ctx.db)).toHaveLength(1);
  });

  it("keeps a test's own name free for itself, in another case too", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    expect((await updateTest(ctx, { testId: id, test: { ...CRP, name: "crp" } })).ok).toBe(true);
  });

  it("refuses a name another active test holds", async () => {
    const ctx = await teacher();
    await created(ctx);
    const id = await created(ctx, GLUCOSE);
    expect(await updateTest(ctx, { testId: id, test: { ...GLUCOSE, name: "Crp" } })).toEqual({
      ok: false,
      error: "name_taken",
    });
  });

  it("refuses an unknown or malformed test with not_found", async () => {
    const ctx = await teacher();
    expect(await updateTest(ctx, { testId: UNKNOWN, test: CRP })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await updateTest(ctx, { testId: "not-a-uuid", test: CRP })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("refuses to change a retired test", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    await retireTest(ctx, { testId: id });
    expect(await updateTest(ctx, { testId: id, test: { ...CRP, material: "serum" } })).toEqual({
      ok: false,
      error: "retired",
    });
  });
});

describe("a test a simulation uses (D9, #266 acceptance criterion)", () => {
  it("cannot have its unit changed", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    used.add(id);
    expect(await updateTest(ctx, { testId: id, test: { ...CRP, unit: "mg/dL" } })).toEqual({
      ok: false,
      error: "in_use",
    });
    expect((await stored(ctx.db, id)).unit).toBe("mg/L");
  });

  it("cannot have its source or its analyte changed", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    used.add(id);
    for (const source of [
      { kind: "manual" } as const,
      { kind: "afinion", analyte: "hsCRP" } as const,
    ]) {
      expect(await updateTest(ctx, { testId: id, test: { ...CRP, source } })).toEqual({
        ok: false,
        error: "in_use",
      });
    }
  });

  it("can still switch who calculates and change its name and material (D9)", async () => {
    const ctx = await teacher();
    const id = await created(ctx, GLUCOSE);
    used.add(id);
    const result = await updateTest(ctx, {
      testId: id,
      test: {
        ...GLUCOSE,
        name: "Glucose (fasting)",
        material: "serum",
        source: { kind: "epoch_upload", calculatedBy: "edulims" },
      },
    });
    expect(result).toEqual({ ok: true, testId: id });
  });

  it("can be retired", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    used.add(id);
    expect(await retireTest(ctx, { testId: id })).toEqual({ ok: true, testId: id });
  });

  it("shows as in use in the list", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    used.add(id);
    const page = await readTestPage(ctx, {});
    expect(page.rows.map((row) => [row.id, row.inUse])).toEqual([[id, true]]);
  });
});

describe("retireTest and restoreTest (D9)", () => {
  it("retires a test, keeps the row and logs test_retired", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    expect(await retireTest(ctx, { testId: id })).toEqual({ ok: true, testId: id });
    expect((await stored(ctx.db, id)).retired_at).toEqual(NOW);
    expect((await events(ctx.db)).at(-1)).toMatchObject({
      action: "test_retired",
      target_id: id,
      metadata: null,
    });
  });

  it("refuses to retire twice and to retire an unknown test", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    await retireTest(ctx, { testId: id });
    expect(await retireTest(ctx, { testId: id })).toEqual({ ok: false, error: "retired" });
    expect(await retireTest(ctx, { testId: UNKNOWN })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("restores a retired test and logs test_restored", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    await retireTest(ctx, { testId: id });
    expect(await restoreTest(ctx, { testId: id })).toEqual({ ok: true, testId: id });
    expect((await stored(ctx.db, id)).retired_at).toBeNull();
    expect((await events(ctx.db)).at(-1)).toMatchObject({ action: "test_restored" });
  });

  it("refuses to restore an active test and an unknown test", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    expect(await restoreTest(ctx, { testId: id })).toEqual({ ok: false, error: "not_retired" });
    expect(await restoreTest(ctx, { testId: UNKNOWN })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("refuses to restore a test whose name an active test took meanwhile", async () => {
    const ctx = await teacher();
    const old = await created(ctx);
    await retireTest(ctx, { testId: old });
    await created(ctx, { ...CRP, name: "crp" });
    expect(await restoreTest(ctx, { testId: old })).toEqual({ ok: false, error: "name_taken" });
  });
});

describe("only teachers read or change the catalogue (D9, A01)", () => {
  it.each([
    ["a student", ["student"]],
    ["an administrator", ["admin"]],
    ["a user without a role", []],
  ] as const)("%s is refused with 403 by every function", async (_name, roles) => {
    const owner = await teacher();
    const id = await created(owner);
    const ctx = await teacher("caller", roles);
    const refusals = [
      () => createTest(ctx, GLUCOSE),
      () => updateTest(ctx, { testId: id, test: { ...CRP, unit: "mg/dL" } }),
      () => retireTest(ctx, { testId: id }),
      () => restoreTest(ctx, { testId: id }),
      () => readTestPage(ctx, {}),
    ];
    for (const call of refusals) {
      const error: unknown = await call().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ status: 403 });
    }
    expect(await stored(owner.db, id)).toMatchObject({ unit: "mg/L", retired_at: null });
    expect(await events(owner.db)).toHaveLength(1);
  });

  it("a teacher-admin may change the catalogue as a teacher", async () => {
    const ctx = await teacher("teacher-admin", ["teacher", "admin"]);
    expect((await createTest(ctx, CRP)).ok).toBe(true);
  });
});

describe("the database holds the catalogue's rules (D9)", () => {
  /** Inserts a raw row in a savepoint, so a refused insert leaves the test's transaction usable. */
  async function insert(values: Record<string, string | null>) {
    db ??= await createTestDb();
    return db.transaction().execute((trx) =>
      trx
        .insertInto("catalogue_tests")
        .values({ name: "X", unit: "U", material: "M", source: "manual", ...values })
        .execute(),
    );
  }

  it("refuses an Afinion 2 test without an analyte", async () => {
    await expect(insert({ source: "afinion" })).rejects.toThrow(/catalogue_tests_afinion_analyte/);
  });

  it("refuses an analyte that holds an HL7 delimiter", async () => {
    await expect(insert({ source: "afinion", afinion_analyte: "CR|P" })).rejects.toThrow(
      /catalogue_tests_afinion_analyte/,
    );
  });

  it("refuses an analyte on a test of another source", async () => {
    await expect(insert({ afinion_analyte: "CRP" })).rejects.toThrow(
      /catalogue_tests_afinion_analyte/,
    );
  });

  it("refuses an Epoch 2 test without its calculator, and a calculator elsewhere", async () => {
    await expect(insert({ source: "epoch_upload" })).rejects.toThrow(
      /catalogue_tests_epoch_calculated_by/,
    );
    await expect(insert({ epoch_calculated_by: "team" })).rejects.toThrow(
      /catalogue_tests_epoch_calculated_by/,
    );
  });

  it("refuses an unknown source and untrimmed text", async () => {
    await expect(insert({ source: "usb" })).rejects.toThrow(/catalogue_tests_source/);
    await expect(insert({ unit: " mg/L" })).rejects.toThrow(/catalogue_tests_unit/);
  });
});

describe("isNameTaken", () => {
  it("recognises only the unique violation of an active test's name", () => {
    const violation = { code: "23505", constraint: "catalogue_tests_active_name_key" };
    expect(isNameTaken(violation)).toBe(true);
    expect(isNameTaken({ ...violation, constraint: "other_key" })).toBe(false);
    expect(isNameTaken(new Error("x"))).toBe(false);
    expect(isNameTaken(null)).toBe(false);
  });
});
