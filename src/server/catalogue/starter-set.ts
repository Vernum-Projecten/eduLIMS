// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The starter set of the test catalogue (D9; owner 2026-11-20 on #393): a fresh installation
// carries the standard Afinion 2 tests, so an administrator only adds the Epoch 2 tests. Only
// analyser facts (src/lib/afinion.ts): no test of a simulation scenario and no correct value
// (Q-PRIV-4). Runs on plain Node from the host CLI and from `pnpm db:seed`.
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import { AFINION_ANALYTES, type AfinionAnalyteName } from "../../lib/afinion.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";

/** One test of the starter set: its name and material, the analyte gives its unit. */
interface StarterTest {
  readonly analyte: AfinionAnalyteName;
  readonly name: string;
  readonly material: string;
}

// NOTE: #393; the names spell out the analyser's OBX-3 abbreviations, and the material follows
// the assay: ACR reads urine (User Manual, code 108), the others blood (Protocol §3.7, OBR-15).
const NAMES: Readonly<Record<AfinionAnalyteName, Omit<StarterTest, "analyte">>> = {
  CRP: { name: "CRP", material: "Blood" },
  ACR: { name: "Albumin/creatinine ratio (ACR)", material: "Urine" },
  Alb: { name: "Albumin", material: "Urine" },
  Creat: { name: "Creatinine", material: "Urine" },
  Chol: { name: "Total cholesterol", material: "Blood" },
  LDL: { name: "LDL cholesterol", material: "Blood" },
  HDL: { name: "HDL cholesterol", material: "Blood" },
  Trig: { name: "Triglycerides", material: "Blood" },
  "non-HDL": { name: "Non-HDL cholesterol", material: "Blood" },
  "Chol/HDL": { name: "Cholesterol/HDL ratio", material: "Blood" },
  HbA1c: { name: "HbA1c", material: "Blood" },
};

/** The starter set, one test per analyte the Afinion 2 reports, with its documented unit. */
export const STARTER_TESTS = AFINION_ANALYTES.map((entry) => ({
  analyte: entry.analyte,
  unit: entry.unit,
  ...NAMES[entry.analyte],
}));

/**
 * Adds the starter set when the catalogue holds no test at all, and returns how many tests it
 * added. A catalogue with any test, a retired one included, is left alone, so a starter test an
 * administrator retired or renamed never comes back. The table lock makes two runs at once add
 * the set once. Logs `test_created` per test with the actor `system` (B4).
 */
export async function seedStarterCatalogue(db: Kysely<DB>): Promise<number> {
  return db.transaction().execute(async (trx) => {
    await sql`lock table catalogue_tests in share row exclusive mode`.execute(trx);
    const existing = await trx
      .selectFrom("catalogue_tests")
      .select("id")
      .limit(1)
      .executeTakeFirst();
    if (existing) return 0;
    const rows = await trx
      .insertInto("catalogue_tests")
      .values(
        STARTER_TESTS.map((test) => ({
          name: test.name,
          unit: test.unit,
          material: test.material,
          source: "afinion",
          afinion_analyte: test.analyte,
          epoch_calculated_by: null,
        })),
      )
      .returning("id")
      .execute();
    for (const row of rows) {
      await recordAudit(trx, {
        action: "test_created",
        actor: { type: "system" },
        outcome: "success",
        target: { type: "test", id: row.id },
      });
    }
    return rows.length;
  });
}
