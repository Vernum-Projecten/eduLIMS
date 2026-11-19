// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Parallel creates on a committed database (D9, #266): the names of active tests stay unique
// case-insensitively when ten teachers add the same test at once.
import { afterEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { person } from "../simulations/test-helpers.ts";
import { createTest } from "./actions.ts";

let committed: CommittedTestDb | undefined;

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
});

describe("parallel creates (D9, #266)", () => {
  it("lets one of ten parallel creates of one name through, whatever its case", async () => {
    committed = await createCommittedTestDb(12);
    const { db } = committed;
    const actor = await person(db, "racing-teacher", ["teacher"]);
    const now = new Date("2026-11-19T09:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        createTest(
          { db, actor, now },
          {
            name: index % 2 === 0 ? "Cholesterol" : "CHOLESTEROL",
            unit: "mmol/L",
            material: "serum",
            source: { kind: "manual" },
          },
        ),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual(
      Array.from({ length: 9 }, () => ({ ok: false, error: "name_taken" })),
    );
    const rows = await db.selectFrom("catalogue_tests").select("id").execute();
    expect(rows).toHaveLength(1);
    const logged = await db
      .selectFrom("audit_event")
      .select("action")
      .where("action", "=", "test_created")
      .execute();
    expect(logged).toHaveLength(1);
  });
});
