// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { CatalogueTestId, TestUsage } from "../../lib/catalogue.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import {
  CatalogueTestRowInvalidError,
  listTests,
  type StoredTest,
  storedSource,
  testFacets,
  toCatalogueTestRow,
} from "./queries.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

const BASE = new Date("2026-11-01T08:00:00Z");
const none = () => Promise.resolve(new Map<CatalogueTestId, TestUsage>());

/** Five invented tests of the fictional test set, changed one hour apart. */
async function seeded(): Promise<Kysely<DB>> {
  db = await createTestDb();
  const rows = [
    ["CRP", "mg/L", "blood", "afinion", "CRP", null, false],
    ["HbA1c", "%", "blood", "afinion", "HbA1c", null, false],
    ["Glucose", "mmol/L", "plasma", "epoch_upload", null, "team", false],
    ["Albumin", "g/L", "serum", "epoch_upload", null, "edulims", true],
    ["LDL (calculated)", "mmol/L", "serum", "manual", null, null, false],
  ] as const;
  await db
    .insertInto("catalogue_tests")
    .values(
      rows.map(([name, unit, material, source, analyte, calculatedBy, retired], index) => ({
        name,
        unit,
        material,
        source,
        afinion_analyte: analyte,
        epoch_calculated_by: calculatedBy,
        updated_at: new Date(BASE.getTime() + index * 3_600_000),
        retired_at: retired ? BASE : null,
      })),
    )
    .execute();
  return db;
}

describe("listTests (D9)", () => {
  it("sorts by name by default and maps each source with its setting", async () => {
    const database = await seeded();
    const page = await listTests(database, {}, none);
    expect(page.total).toBe(5);
    expect(page.rows.map((row) => row.name)).toEqual([
      "Albumin",
      "CRP",
      "Glucose",
      "HbA1c",
      "LDL (calculated)",
    ]);
    expect(page.rows.map((row) => [row.name, row.source, row.status, row.usage])).toContainEqual([
      "Albumin",
      { kind: "epoch_upload", calculatedBy: "edulims" },
      "retired",
      "unused",
    ]);
  });

  it("searches name, unit, material and analyte, case-insensitively", async () => {
    const database = await seeded();
    const names = async (q: string) =>
      (await listTests(database, { q }, none)).rows.map((row) => row.name);
    expect(await names("hba1c")).toEqual(["HbA1c"]);
    expect(await names("MMOL")).toEqual(["Glucose", "LDL (calculated)"]);
    expect(await names("serum")).toEqual(["Albumin", "LDL (calculated)"]);
    expect(await names("100%")).toEqual([]);
  });

  it("filters on status and source, and pages with the total", async () => {
    const database = await seeded();
    const active = await listTests(
      database,
      { status: ["active"], source: ["epoch_upload"] },
      none,
    );
    expect(active.rows.map((row) => row.name)).toEqual(["Glucose"]);
    const page = await listTests(
      database,
      { sort: "updatedAt", dir: "desc", size: 10, page: 1 },
      none,
    );
    expect(page.rows.at(0)?.name).toBe("LDL (calculated)");
  });

  it("marks each test with the usage the rule names", async () => {
    const database = await seeded();
    const page = await listTests(database, { q: "crp" }, (ids) =>
      Promise.resolve(new Map(ids.map((id) => [id, "running" as const]))),
    );
    expect(page.rows.map((row) => row.usage)).toEqual(["running"]);
  });
});

describe("testFacets (D9)", () => {
  it("counts each facet value with the search and the other facet applied", async () => {
    const database = await seeded();
    expect(await testFacets(database, { status: ["active"] })).toEqual({
      status: { active: 4, retired: 1 },
      source: { afinion: 2, epoch_upload: 1, manual: 1 },
    });
  });
});

describe("a stored row the CHECKs should have refused", () => {
  const row: StoredTest = {
    id: "01960000-0000-7000-8000-000000000001",
    name: "X",
    unit: "U",
    material: "M",
    source: "afinion",
    afinion_analyte: null,
    epoch_calculated_by: null,
    updated_at: BASE,
    retired_at: null,
  };

  it("fails loud instead of guessing a source", () => {
    expect(() => storedSource(row)).toThrow(CatalogueTestRowInvalidError);
    expect(() => storedSource({ ...row, source: "epoch_upload" })).toThrow(
      CatalogueTestRowInvalidError,
    );
    expect(() => storedSource({ ...row, source: "usb" })).toThrow(CatalogueTestRowInvalidError);
  });

  it("fails loud on an id that is not a UUID", () => {
    expect(() => toCatalogueTestRow({ ...row, id: "1", source: "manual" }, "unused")).toThrow(
      CatalogueTestRowInvalidError,
    );
  });
});
