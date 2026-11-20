// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared set-up of the results tests: the records world with an invented patient, a request for
// two hand-entered tests with two tubes, and the team's own tolerance for the first test. Every
// value is invented (Q-PRIV-4). Test support only.
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { patientIn, recordsWorld, requestFor } from "../lab-records/test-helpers.ts";
import type { Person } from "../simulations/test-helpers.ts";
import { setTolerance } from "../tolerances/actions.ts";
import { recordManualMeasurement } from "./measurements.ts";

/** The records world with a patient, a request for both tests on two samples, and a tolerance. */
export async function resultsWorld(db: Kysely<DB>) {
  const w = await recordsWorld(db);
  const patientId = await patientIn(db, w.student, w.labId);
  const request = await requestFor(db, w.student, w.labId, patientId, [w.hba1c, w.crp], {
    samples: [
      { sampleNumber: "S-001", material: "whole blood" },
      { sampleNumber: "S-001", material: "whole blood" },
    ],
  });
  const [first, second] = request.samples;
  if (!first || !second) throw new Error("no samples");
  const toleranceId = await toleranceFor(db, w.student, w.labId, w.hba1c, "4.0", "6.0");
  return { ...w, patientId, requestId: request.requestId, first, second, toleranceId };
}

/** The world {@link resultsWorld} builds. */
export type ResultsWorld = Awaited<ReturnType<typeof resultsWorld>>;

/** Sets a tolerance through the service and returns the id of the row in force. */
export async function toleranceFor(
  db: Kysely<DB>,
  actor: Person,
  labId: string,
  testId: string,
  lower: string,
  upper: string,
): Promise<string> {
  const set = await setTolerance(db, actor, { labId, testId, lower, upper });
  if (!set.ok) throw new Error(set.error);
  const row = await db
    .selectFrom("lab_tolerances")
    .select("id")
    .where("lab_id", "=", labId)
    .where("test_id", "=", testId)
    .orderBy("set_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Records a measurement by hand as the world's first student and returns its id. */
export async function measure(
  db: Kysely<DB>,
  w: ResultsWorld,
  value: string,
  options: { testId?: string; sampleId?: string } = {},
): Promise<string> {
  const result = await recordManualMeasurement(db, w.student, {
    labId: w.labId,
    requestId: w.requestId,
    testId: options.testId ?? w.hba1c,
    sampleId: options.sampleId ?? w.first.id,
    value,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value.measurementId;
}
