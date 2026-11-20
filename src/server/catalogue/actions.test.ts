// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The changes to the test catalogue (D9, S4, #266) on a real database: the rules of a test, the
// activity-log rows with ids only (B4), and the refusal of every role but admin (A01, #393).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestUsage } from "../../lib/catalogue.ts";
import { AuthError } from "../middleware.ts";
import {
  createTest,
  isAnalyteTaken,
  isNameTaken,
  restoreTest,
  retireTest,
  updateTest,
} from "./actions.ts";
import { readTestPage } from "./reads.ts";
import {
  CRP,
  catalogueTestDb,
  created,
  events,
  GLUCOSE,
  LATER,
  NOW,
  stored,
  UNKNOWN,
} from "./test-helpers.ts";

// NOTE: #266; no table refers to a test yet, so the use of a test is mocked until #267 makes it real.
const usages = vi.hoisted(() => new Map<string, TestUsage>());
vi.mock("./in-use.ts", () => ({
  usageOf: (_db: unknown, id: string) => Promise.resolve(usages.get(id) ?? "unused"),
  testUsage: (_db: unknown, ids: readonly string[]) =>
    Promise.resolve(
      new Map(
        ids.flatMap((id) => {
          const usage = usages.get(id);
          return usage ? [[id, usage] as const] : [];
        }),
      ),
    ),
}));

const setup = catalogueTestDb();
const admin = setup.admin;

beforeEach(() => usages.clear());

afterEach(() => setup.destroy());

describe("createTest (D9)", () => {
  it("adds a test with its name, unit and material and logs test_created with ids only", async () => {
    const ctx = await admin();
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
        actor_type: "user",
        actor_id: ctx.actor.id,
        target_type: "test",
        target_id: id,
        outcome: "success",
        reason_code: null,
        metadata: null,
      },
    ]);
  });

  it("stores who calculates an Epoch 2 concentration, and nothing of an analyte (D9, S4)", async () => {
    const ctx = await admin();
    const id = await created(ctx, GLUCOSE);
    expect(await stored(ctx.db, id)).toMatchObject({
      source: "epoch_upload",
      afinion_analyte: null,
      epoch_calculated_by: "team",
    });
  });

  it("stores a test entered by hand without a setting (O8)", async () => {
    const ctx = await admin();
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
    const ctx = await admin();
    await created(ctx);
    expect(await createTest(ctx, { ...CRP, name: "crp" })).toEqual({
      ok: false,
      error: "name_taken",
    });
    // ASVS V16.3.3: the refusal leaves its own row, with the code and no test of its own.
    expect((await events(ctx.db)).at(-1)).toEqual({
      action: "test_created",
      actor_type: "user",
      actor_id: ctx.actor.id,
      target_type: null,
      target_id: null,
      outcome: "refused",
      reason_code: "name_taken",
      metadata: null,
    });
  });

  it("accepts the name of a retired test", async () => {
    const ctx = await admin();
    const old = await created(ctx);
    await retireTest(ctx, { testId: old });
    expect((await createTest(ctx, CRP)).ok).toBe(true);
  });
});

describe("updateTest (D9)", () => {
  it("lets any administrator change any test, and logs the names of the changed settings", async () => {
    const owner = await admin();
    const id = await created(owner, GLUCOSE);
    const other = await admin("other-admin", ["admin"], LATER);
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
      actor_type: "user",
      actor_id: other.actor.id,
      target_type: "test",
      target_id: id,
      outcome: "success",
      reason_code: null,
      metadata: { fields: ["material", "calculated_by"] },
    });
  });

  it("drops the setting of the old source when the source changes", async () => {
    const ctx = await admin();
    const id = await created(ctx, GLUCOSE);
    await updateTest(ctx, { testId: id, test: { ...GLUCOSE, source: { kind: "manual" } } });
    expect(await stored(ctx.db, id)).toMatchObject({
      source: "manual",
      epoch_calculated_by: null,
    });
  });

  it("writes nothing and logs nothing when nothing changed", async () => {
    const ctx = await admin();
    const id = await created(ctx);
    expect(await updateTest(ctx, { testId: id, test: CRP })).toEqual({ ok: true, testId: id });
    expect(await events(ctx.db)).toHaveLength(1);
  });

  it("keeps a test's own name free for itself, in another case too", async () => {
    const ctx = await admin();
    const id = await created(ctx);
    expect((await updateTest(ctx, { testId: id, test: { ...CRP, name: "crp" } })).ok).toBe(true);
  });

  it("refuses a name another active test holds", async () => {
    const ctx = await admin();
    await created(ctx);
    const id = await created(ctx, GLUCOSE);
    expect(await updateTest(ctx, { testId: id, test: { ...GLUCOSE, name: "Crp" } })).toEqual({
      ok: false,
      error: "name_taken",
    });
  });

  it("refuses an unknown or malformed test with not_found", async () => {
    const ctx = await admin();
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
    const ctx = await admin();
    const id = await created(ctx);
    await retireTest(ctx, { testId: id });
    expect(await updateTest(ctx, { testId: id, test: { ...CRP, material: "serum" } })).toEqual({
      ok: false,
      error: "retired",
    });
  });
});

describe("retireTest and restoreTest (D9)", () => {
  it("retires a test, keeps the row and logs test_retired", async () => {
    const ctx = await admin();
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
    const ctx = await admin();
    const id = await created(ctx);
    await retireTest(ctx, { testId: id });
    expect(await retireTest(ctx, { testId: id })).toEqual({ ok: false, error: "retired" });
    expect(await retireTest(ctx, { testId: UNKNOWN })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("restores a retired test and logs test_restored", async () => {
    const ctx = await admin();
    const id = await created(ctx);
    await retireTest(ctx, { testId: id });
    expect(await restoreTest(ctx, { testId: id })).toEqual({ ok: true, testId: id });
    expect((await stored(ctx.db, id)).retired_at).toBeNull();
    expect((await events(ctx.db)).at(-1)).toMatchObject({ action: "test_restored" });
  });

  it("refuses to restore an active test and an unknown test", async () => {
    const ctx = await admin();
    const id = await created(ctx);
    expect(await restoreTest(ctx, { testId: id })).toEqual({ ok: false, error: "not_retired" });
    expect(await restoreTest(ctx, { testId: UNKNOWN })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("refuses to restore a test whose name an active test took meanwhile", async () => {
    const ctx = await admin();
    const old = await created(ctx);
    await retireTest(ctx, { testId: old });
    await created(ctx, { ...CRP, name: "crp" });
    expect(await restoreTest(ctx, { testId: old })).toEqual({ ok: false, error: "name_taken" });
  });
});

describe("only administrators read or change the whole catalogue (D9, A01, #393)", () => {
  it.each([
    ["a student", ["student"]],
    ["a teacher", ["teacher"]],
    ["a user without a role", []],
  ] as const)("%s is refused with 403 by every function", async (_name, roles) => {
    const owner = await admin();
    const id = await created(owner);
    const ctx = await admin("caller", roles);
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

  it("a teacher-admin may change the catalogue as an administrator", async () => {
    const ctx = await admin("teacher-admin", ["teacher", "admin"]);
    expect((await createTest(ctx, CRP)).ok).toBe(true);
  });
});

describe("the database holds the catalogue's rules (D9)", () => {
  /** Inserts a raw row in a savepoint, so a refused insert leaves the test's transaction usable. */
  async function insert(values: Record<string, string | null>) {
    const db = await setup.database();
    return db.transaction().execute((trx) =>
      trx
        .insertInto("catalogue_tests")
        .values({ name: "X", unit: "U/L", material: "M", source: "manual", ...values })
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

describe("isAnalyteTaken", () => {
  it("recognises only the unique violation of an active analyte", () => {
    const violation = { code: "23505", constraint: "catalogue_tests_active_analyte_key" };
    expect(isAnalyteTaken(violation)).toBe(true);
    expect(isAnalyteTaken({ ...violation, constraint: "catalogue_tests_active_name_key" })).toBe(
      false,
    );
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
