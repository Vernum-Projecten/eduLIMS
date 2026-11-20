// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The read of the catalogue (D9, A01; owner 2026-11-20 on #393): an administrator reads the whole
// catalogue with its materials, searchable by a unit as the screen shows it; no other role reads it.
import { afterEach, describe, expect, it } from "vitest";
import { AuthError } from "../middleware.ts";
import { readTestPage } from "./reads.ts";
import { CRP, catalogueTestDb, created, GLUCOSE } from "./test-helpers.ts";

const setup = catalogueTestDb();

afterEach(() => setup.destroy());

describe("who reads the catalogue (D9, A01, #393)", () => {
  it.each([
    ["a teacher", ["teacher"]],
    ["a student", ["student"]],
    ["a user without a role", []],
  ] as const)("refuses %s with 403", async (_name, roles) => {
    const ctx = await setup.admin("caller", roles);
    const error: unknown = await readTestPage(ctx, {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 403 });
  });

  it("is open to a teacher-admin", async () => {
    const ctx = await setup.admin("teacher-admin", ["teacher", "admin"]);
    expect((await readTestPage(ctx, {})).rows).toEqual([]);
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

  it("finds a test by its unit as the screen shows it: symbol, code or name (#404)", async () => {
    const admin = await setup.admin();
    await created(admin, { ...GLUCOSE, name: "Bilirubin", unit: "umol/L" });
    await created(admin, GLUCOSE);
    const names = async (q: string) =>
      (await readTestPage(admin, { q })).rows.map((row) => row.name);
    expect(await names("µmol")).toEqual(["Bilirubin"]);
    expect(await names("umol/L")).toEqual(["Bilirubin"]);
    expect(await names("micromole")).toEqual(["Bilirubin"]);
    expect(await names("millimole per litre")).toEqual(["Glucose"]);
  });
});
