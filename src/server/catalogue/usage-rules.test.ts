// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What a test's usage fixes (D9; maintainer 2026-11-19 on #266), a test without a unit, and the
// analyte name of an active Afinion 2 test, on a real database with the usage mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestUsage } from "../../lib/catalogue.ts";
import { createTest, restoreTest, retireTest, updateTest } from "./actions.ts";
import { readTestPage } from "./reads.ts";
import type { TestDefinition } from "./schemas.ts";
import { CRP, catalogueTestDb, created, events, GLUCOSE, stored } from "./test-helpers.ts";

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
const teacher = setup.teacher;

beforeEach(() => usages.clear());

afterEach(() => setup.destroy());

describe("a test a simulation uses (D9, #266 acceptance criterion)", () => {
  it("cannot have its unit changed", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    usages.set(id, "used");
    expect(await updateTest(ctx, { testId: id, test: { ...CRP, unit: "mg/dL" } })).toEqual({
      ok: false,
      error: "in_use",
    });
    expect((await stored(ctx.db, id)).unit).toBe("mg/L");
  });

  it("cannot have its source or its analyte changed", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    usages.set(id, "used");
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
    usages.set(id, "used");
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
    usages.set(id, "used");
    expect(await retireTest(ctx, { testId: id })).toEqual({ ok: true, testId: id });
  });

  it("shows as in use in the list", async () => {
    const ctx = await teacher();
    const id = await created(ctx);
    usages.set(id, "used");
    const page = await readTestPage(ctx, {});
    expect(page.rows.map((row) => [row.id, row.usage])).toEqual([[id, "used"]]);
  });

  it("lets its material and who calculates change outside a running simulation", async () => {
    const ctx = await teacher();
    const id = await created(ctx, GLUCOSE);
    usages.set(id, "used");
    const result = await updateTest(ctx, {
      testId: id,
      test: {
        ...GLUCOSE,
        material: "serum",
        source: { kind: "epoch_upload", calculatedBy: "edulims" },
      },
    });
    expect(result).toEqual({ ok: true, testId: id });
  });
});

describe("a test a running simulation uses (D9; maintainer 2026-11-19)", () => {
  it("cannot have its material changed", async () => {
    const ctx = await teacher();
    const id = await created(ctx, GLUCOSE);
    usages.set(id, "running");
    expect(await updateTest(ctx, { testId: id, test: { ...GLUCOSE, material: "serum" } })).toEqual({
      ok: false,
      error: "in_running_simulation",
    });
    expect((await stored(ctx.db, id)).material).toBe("plasma");
  });

  it("cannot switch who calculates", async () => {
    const ctx = await teacher();
    const id = await created(ctx, GLUCOSE);
    usages.set(id, "running");
    expect(
      await updateTest(ctx, {
        testId: id,
        test: { ...GLUCOSE, source: { kind: "epoch_upload", calculatedBy: "edulims" } },
      }),
    ).toEqual({ ok: false, error: "in_running_simulation" });
  });

  it("still refuses a unit change as in_use, and accepts a new name", async () => {
    const ctx = await teacher();
    const id = await created(ctx, GLUCOSE);
    usages.set(id, "running");
    expect(await updateTest(ctx, { testId: id, test: { ...GLUCOSE, unit: "mg/dL" } })).toEqual({
      ok: false,
      error: "in_use",
    });
    expect(
      await updateTest(ctx, { testId: id, test: { ...GLUCOSE, name: "Glucose (fasting)" } }),
    ).toEqual({ ok: true, testId: id });
  });

  it("can be retired", async () => {
    const ctx = await teacher();
    const id = await created(ctx, GLUCOSE);
    usages.set(id, "running");
    expect(await retireTest(ctx, { testId: id })).toEqual({ ok: true, testId: id });
  });
});

describe("a test without a unit (maintainer 2026-11-19)", () => {
  const RATIO: TestDefinition = {
    name: "Chol/HDL",
    unit: null,
    material: "blood",
    source: { kind: "afinion", analyte: "Chol/HDL" },
  };

  it("is stored with no unit, not an empty one", async () => {
    const ctx = await teacher();
    const id = await created(ctx, RATIO);
    expect((await stored(ctx.db, id)).unit).toBeNull();
    const page = await readTestPage(ctx, {});
    expect(page.rows.map((row) => row.unit)).toEqual([null]);
  });

  it("gets a unit, and loses it again, as a logged change", async () => {
    const ctx = await teacher();
    const id = await created(ctx, RATIO);
    await updateTest(ctx, { testId: id, test: { ...RATIO, unit: "ratio" } });
    await updateTest(ctx, { testId: id, test: RATIO });
    expect((await stored(ctx.db, id)).unit).toBeNull();
    const fields = (await events(ctx.db)).map((event) => event.metadata);
    expect(fields).toEqual([null, { fields: ["unit"] }, { fields: ["unit"] }]);
  });

  it("keeps having no unit while a simulation uses it", async () => {
    const ctx = await teacher();
    const id = await created(ctx, RATIO);
    usages.set(id, "used");
    expect(await updateTest(ctx, { testId: id, test: { ...RATIO, unit: "ratio" } })).toEqual({
      ok: false,
      error: "in_use",
    });
  });
});

describe("the analyte name of an active Afinion 2 test (maintainer 2026-11-19)", () => {
  it("is refused when another active Afinion 2 test has it, in any case", async () => {
    const ctx = await teacher();
    await created(ctx);
    expect(
      await createTest(ctx, {
        ...CRP,
        name: "CRP (point of care)",
        source: { kind: "afinion", analyte: "crp" },
      }),
    ).toEqual({
      ok: false,
      error: "analyte_taken",
    });
  });

  it("is refused on an edit that takes another test's analyte", async () => {
    const ctx = await teacher();
    await created(ctx);
    const id = await created(ctx, {
      ...CRP,
      name: "HbA1c",
      unit: "%",
      source: { kind: "afinion", analyte: "HbA1c" },
    });
    expect(
      await updateTest(ctx, {
        testId: id,
        test: { ...CRP, name: "HbA1c", unit: "%", source: { kind: "afinion", analyte: "CRP" } },
      }),
    ).toEqual({ ok: false, error: "analyte_taken" });
  });

  it("is free again once the other test is retired, and refused on its restore", async () => {
    const ctx = await teacher();
    const old = await created(ctx);
    await retireTest(ctx, { testId: old });
    await created(ctx, { ...CRP, name: "CRP (new)" });
    expect(await restoreTest(ctx, { testId: old })).toEqual({
      ok: false,
      error: "analyte_taken",
    });
  });

  it("does not bind a test of another source", async () => {
    const ctx = await teacher();
    await created(ctx);
    const result = await createTest(ctx, {
      ...CRP,
      name: "CRP (entered)",
      source: { kind: "manual" },
    });
    expect(result.ok).toBe(true);
  });
});
