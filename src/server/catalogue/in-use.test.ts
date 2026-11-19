// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { parseCatalogueTestId } from "../../lib/catalogue.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { testUsage, usageOf } from "./in-use.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe("a test in use (D9, #266)", () => {
  it("is no test while no simulation refers to the catalogue (#267, #268)", async () => {
    db = await createTestDb();
    const row = await db
      .insertInto("catalogue_tests")
      .values({
        name: "HbA1c",
        unit: "%",
        material: "blood",
        source: "afinion",
        afinion_analyte: "HbA1c",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const id = parseCatalogueTestId(row.id);
    if (id === null) throw new Error("catalogue_tests.id is not a UUID");
    expect(await usageOf(db, id)).toBe("unused");
    expect([...(await testUsage(db, [id]))]).toEqual([]);
  });
});
