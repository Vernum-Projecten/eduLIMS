// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The service refuses a unit outside the UCUM list and a unit an Afinion 2 analyte does not
// allow, on its own, without the server function's schema (D9, #393; security review of #404, F1).
import { afterEach, describe, expect, it } from "vitest";
import { createTest, updateTest } from "./actions.ts";
import { CRP, catalogueTestDb, created, events, GLUCOSE } from "./test-helpers.ts";

const setup = catalogueTestDb();

afterEach(() => setup.destroy());

describe("the unit rules of the service (#404, F1)", () => {
  it("refuses a unit outside the supported UCUM list, and logs the refusal", async () => {
    const ctx = await setup.admin();
    expect(await createTest(ctx, { ...GLUCOSE, unit: "ratio" })).toEqual({
      ok: false,
      error: "unit_unsupported",
    });
    expect(await createTest(ctx, { ...GLUCOSE, unit: "mmol/l" })).toEqual({
      ok: false,
      error: "unit_unsupported",
    });
    const log = await events(ctx.db);
    expect(log.map((row) => [row.outcome, row.reason_code])).toEqual([
      ["refused", "unit_unsupported"],
      ["refused", "unit_unsupported"],
    ]);
  });

  it("refuses CRP in mg/dL, the unit its analyte does not allow, on a create and an edit", async () => {
    const ctx = await setup.admin();
    expect(await createTest(ctx, { ...CRP, unit: "mg/dL" })).toEqual({
      ok: false,
      error: "unit_fixed_by_analyte",
    });
    const id = await created(ctx, CRP);
    expect(await updateTest(ctx, { testId: id, test: { ...CRP, unit: "mg/dL" } })).toEqual({
      ok: false,
      error: "unit_fixed_by_analyte",
    });
  });

  it("lets HbA1c take another supported unit, never none", async () => {
    const ctx = await setup.admin();
    const hba1c = {
      name: "HbA1c",
      unit: "mmol/mol",
      material: "blood",
      source: { kind: "afinion", analyte: "HbA1c" },
    } as const;
    expect((await createTest(ctx, hba1c)).ok).toBe(true);
    expect(await createTest(ctx, { ...hba1c, name: "HbA1c 2", unit: null })).toEqual({
      ok: false,
      error: "unit_fixed_by_analyte",
    });
  });
});
