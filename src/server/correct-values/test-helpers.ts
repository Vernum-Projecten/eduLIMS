// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared set-up of the correct-value tests: invented catalogue tests and invented values whose
// digits appear nowhere else in a response, so a test can search a serialised response for them
// (Q-SIM-1, Q-PRIV-4). Test support only.
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import type { World } from "../simulations/test-helpers.ts";
import { NOW } from "../simulations/test-helpers.ts";
import { setCorrectValues, setLimits } from "./actions.ts";

/** An invented correct value and limits; their digits are the needles of the leak tests. */
export const SECRET_VALUE = "987654.321";
export const SECRET_YELLOW = "4.4321";
export const SECRET_RED = "8.8765";

/** Adds an invented test to the catalogue, entered by hand, and returns its id. */
export async function catalogueTest(
  db: Kysely<DB>,
  name: string,
  options: { retired?: boolean; material?: string } = {},
): Promise<string> {
  const row = await db
    .insertInto("catalogue_tests")
    .values({
      name,
      unit: "mmol/L",
      material: options.material ?? "plasma",
      source: "manual",
      retired_at: options.retired ? NOW : null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Gives the world's first simulation a test with the secret value for sample `S-001` and the
 * secret limits, through the service, and returns the test's id.
 */
export async function seedSecrets(db: Kysely<DB>, w: World): Promise<string> {
  const testId = await catalogueTest(db, "Glucose (invented)");
  const set = await setCorrectValues(
    db,
    w.teacher,
    {
      simulationId: w.simulationId,
      rows: [{ sampleNumber: "S-001", testId, value: SECRET_VALUE }],
    },
    NOW,
  );
  if (!set.ok) throw new Error(set.error);
  const limits = await setLimits(
    db,
    w.teacher,
    {
      simulationId: w.simulationId,
      testId,
      kind: "absolute",
      yellow: SECRET_YELLOW,
      red: SECRET_RED,
    },
    NOW,
  );
  if (!limits.ok) throw new Error(limits.error);
  return testId;
}
