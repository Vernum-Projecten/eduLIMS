// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import {
  AnalyserRowInvalidError,
  analyserFacets,
  listAnalysers,
  toAnalyserRow,
} from "./queries.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

const BASE = new Date("2026-11-01T08:00:00Z");

/** Five analysers of the fictional test set, changed one hour apart. */
async function seeded(): Promise<Kysely<DB>> {
  db = await createTestDb();
  const rows = [
    ["Abbott Afinion 2", "AF2-0001", "Lab A", "hl7_ferrobridge", "in_use"],
    ["Abbott Afinion 2", "AF2-0002", "Lab B", "hl7_ferrobridge", "maintenance"],
    ["BioTek Epoch 2", "EP2-0001", "Lab A", "excel_upload", "in_use"],
    ["BioTek Epoch 2", "EP2-0002", "Lab C", "excel_upload", "in_use"],
    ["BioTek Epoch 2", "EP2-0003", "Store", "excel_upload", "retired"],
  ] as const;
  await db
    .insertInto("analysers")
    .values(
      rows.map(([model, serial, location, route, status], index) => ({
        model,
        serial_number: serial,
        location,
        route,
        status,
        updated_at: new Date(BASE.getTime() + index * 3_600_000),
        retired_at: status === "retired" ? BASE : null,
      })),
    )
    .execute();
  return db;
}

const serials = (page: { rows: { serialNumber: string }[] }) =>
  page.rows.map((row) => row.serialNumber);

describe("listAnalysers (B3)", () => {
  it("sorts by model by default, with the id as tie-break", async () => {
    const page = await listAnalysers(await seeded(), {});
    expect(page.total).toBe(5);
    expect(page.rows.slice(0, 2).map((row) => row.model)).toEqual([
      "Abbott Afinion 2",
      "Abbott Afinion 2",
    ]);
    expect(page.rows.at(-1)?.model).toBe("BioTek Epoch 2");
  });

  it("sorts by the last change, newest first", async () => {
    const page = await listAnalysers(await seeded(), { sort: "updatedAt", dir: "desc" });
    expect(serials(page)).toEqual(["EP2-0003", "EP2-0002", "EP2-0001", "AF2-0002", "AF2-0001"]);
  });

  it("filters on any of the chosen statuses", async () => {
    const page = await listAnalysers(await seeded(), {
      status: ["maintenance", "retired"],
      sort: "serialNumber",
    });
    expect(serials(page)).toEqual(["AF2-0002", "EP2-0003"]);
  });

  it("combines the route filter with the status filter", async () => {
    const page = await listAnalysers(await seeded(), {
      route: ["excel_upload"],
      status: ["in_use"],
      sort: "serialNumber",
    });
    expect(serials(page)).toEqual(["EP2-0001", "EP2-0002"]);
  });

  it("searches model, serial number and location, case-insensitively", async () => {
    const database = await seeded();
    expect(serials(await listAnalysers(database, { q: "lab a", sort: "serialNumber" }))).toEqual([
      "AF2-0001",
      "EP2-0001",
    ]);
    expect(serials(await listAnalysers(database, { q: "ep2-0003" }))).toEqual(["EP2-0003"]);
    expect((await listAnalysers(database, { q: "%" })).total).toBe(0);
  });

  it("pages with the total of every match", async () => {
    const database = await seeded();
    const page = await listAnalysers(database, { size: 10, page: 1, sort: "serialNumber" });
    expect(page).toMatchObject({ total: 5, page: 1, size: 10 });
    const empty = await listAnalysers(database, { size: 10, page: 2 });
    expect(empty).toMatchObject({ rows: [], total: 5, page: 2 });
  });

  it("returns ISO instants and the retirement time of a retired analyser", async () => {
    const page = await listAnalysers(await seeded(), { status: ["retired"] });
    expect(page.rows[0]).toMatchObject({
      status: "retired",
      retiredAt: BASE.toISOString(),
      route: "excel_upload",
    });
  });
});

describe("analyserFacets (B3)", () => {
  it("counts each value with the other facet applied but not its own", async () => {
    const facets = await analyserFacets(await seeded(), {
      status: ["in_use"],
      route: ["excel_upload"],
    });
    expect(facets).toEqual({
      status: { in_use: 2, maintenance: 0, retired: 1 },
      route: { hl7_ferrobridge: 1, excel_upload: 2 },
    });
  });

  it("applies the search to every count", async () => {
    const facets = await analyserFacets(await seeded(), { q: "Afinion" });
    expect(facets.route).toEqual({ hl7_ferrobridge: 2, excel_upload: 0 });
  });
});

describe("toAnalyserRow", () => {
  it("fails loud on a value outside the vocabulary", () => {
    expect(() =>
      toAnalyserRow({
        id: "x",
        model: "M",
        serial_number: "S",
        location: "L",
        route: "usb",
        status: "in_use",
        notes: null,
        updated_at: BASE,
        retired_at: null,
      }),
    ).toThrow(AnalyserRowInvalidError);
  });
});
