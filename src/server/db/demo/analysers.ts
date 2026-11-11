// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The demo analysers of `pnpm db:seed` (B3, #35): one Abbott Afinion 2 and two BioTek Epoch 2
// readers, with invented serial numbers and rooms. Relative imports: the seed loads this in
// plain Node.
import type { Kysely } from "kysely";
import type { AnalyserRoute } from "../../../lib/analysers.ts";
import type { DB } from "../schema.gen.ts";

/** One demo analyser; the serial numbers follow no manufacturer's scheme. */
export interface DemoAnalyser {
  model: string;
  serialNumber: string;
  location: string;
  route: AnalyserRoute;
}

/** The demo register: the analysers the practicals of the test set measure on. */
export const DEMO_ANALYSERS: readonly DemoAnalyser[] = [
  {
    model: "Abbott Afinion 2",
    serialNumber: "AF2-DEMO-0001",
    location: "Lab A, bench 1",
    route: "hl7_ferrobridge",
  },
  {
    model: "BioTek Epoch 2",
    serialNumber: "EP2-DEMO-0001",
    location: "Lab A, bench 2",
    route: "excel_upload",
  },
  {
    model: "BioTek Epoch 2",
    serialNumber: "EP2-DEMO-0002",
    location: "Lab B, bench 1",
    route: "excel_upload",
  },
];

/**
 * Adds the demo analysers that are not in the register yet and returns how many it added. A
 * second run adds none: the model and serial number are unique.
 */
export async function seedDemoAnalysers(db: Kysely<DB>): Promise<number> {
  const result = await db
    .insertInto("analysers")
    .values(
      DEMO_ANALYSERS.map((analyser) => ({
        model: analyser.model,
        serial_number: analyser.serialNumber,
        location: analyser.location,
        route: analyser.route,
        status: "in_use",
      })),
    )
    .onConflict((oc) => oc.columns(["model", "serial_number"]).doNothing())
    .executeTakeFirst();
  return Number(result.numInsertedOrUpdatedRows ?? 0);
}
