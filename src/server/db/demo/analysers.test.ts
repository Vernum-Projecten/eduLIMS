// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../schema.gen.ts";
import { createTestDb } from "../test-db.ts";
import { DEMO_ANALYSERS, seedDemoAnalysers } from "./analysers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe("seedDemoAnalysers (B3, #35)", () => {
  it("adds one Afinion 2 and two Epoch 2 readers, once", async () => {
    db = await createTestDb();
    expect(await seedDemoAnalysers(db)).toBe(3);
    expect(await seedDemoAnalysers(db)).toBe(0);
    const rows = await db
      .selectFrom("analysers")
      .select(["model", "route", "status"])
      .orderBy("serial_number")
      .execute();
    expect(rows).toEqual([
      { model: "Abbott Afinion 2", route: "hl7_ferrobridge", status: "in_use" },
      { model: "BioTek Epoch 2", route: "excel_upload", status: "in_use" },
      { model: "BioTek Epoch 2", route: "excel_upload", status: "in_use" },
    ]);
  });

  it("uses invented serial numbers only", () => {
    for (const analyser of DEMO_ANALYSERS) expect(analyser.serialNumber).toMatch(/-DEMO-/);
  });
});
