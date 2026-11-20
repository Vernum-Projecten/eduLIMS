// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The reads of the catalogue per role (D9, A01; owner 2026-11-20 on #393): an administrator reads
// the whole catalogue with its materials; a teacher reads the active tests only, and nothing else.
import { afterEach, describe, expect, it } from "vitest";
import { AuthError } from "../middleware.ts";
import { retireTest } from "./actions.ts";
import { readActiveTests, readTestPage } from "./reads.ts";
import { CRP, catalogueTestDb, created, GLUCOSE } from "./test-helpers.ts";

const setup = catalogueTestDb();

afterEach(() => setup.destroy());

describe("a teacher's read of the active tests (D9, D10, #393)", () => {
  it("lists the active tests by name, without the retired ones", async () => {
    const admin = await setup.admin();
    await created(admin, GLUCOSE);
    const crp = await created(admin, CRP);
    await created(admin, { ...GLUCOSE, name: "Albumin", source: { kind: "manual" } });
    await retireTest(admin, { testId: crp });
    const teacher = await setup.admin("teacher", ["teacher"]);
    const tests = await readActiveTests(teacher);
    expect(tests.map((test) => test.name)).toEqual(["Albumin", "Glucose"]);
    expect(tests[1]).toEqual({
      id: expect.any(String),
      name: "Glucose",
      unit: "mmol/L",
      material: "plasma",
      source: "epoch_upload",
    });
  });

  it("is open to a teacher-admin too", async () => {
    const ctx = await setup.admin("teacher-admin", ["teacher", "admin"]);
    expect(await readActiveTests(ctx)).toEqual([]);
  });

  it.each([
    ["a student", ["student"]],
    ["an administrator who is no teacher", ["admin"]],
    ["a user without a role", []],
  ] as const)("refuses %s with 403", async (_name, roles) => {
    const ctx = await setup.admin("caller", roles);
    const error: unknown = await readActiveTests(ctx).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 403 });
  });
});

describe("an administrator's read of the catalogue (D9, #393)", () => {
  it("names each material in use once, in order, for the form's suggestions", async () => {
    const admin = await setup.admin();
    await created(admin, GLUCOSE);
    await created(admin, CRP);
    await created(admin, { ...GLUCOSE, name: "Urea", source: { kind: "manual" } });
    const page = await readTestPage(admin, {});
    expect(page.materials).toEqual(["blood", "plasma"]);
  });
});
