// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared set-up of the records tests: the simulation world of the simulation service, started,
// with invented catalogue tests and invented patients and requests (Q-PRIV-4). Test support only.
import type { Kysely } from "kysely";
import { catalogueTest } from "../correct-values/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { startSimulation } from "../simulations/state.ts";
import { NOW, type Person, world } from "../simulations/test-helpers.ts";
import { registerPatient } from "./patients.ts";
import { type NewRequest, type RequestFields, recordRequest } from "./requests.ts";

/** An invented patient's details, nothing from a real simulation. */
export const PATIENT = {
  name: "Ada Testpatient",
  dateOfBirth: "1984-03-21",
  sex: "female",
  identifier: "PID-000117",
} as const;

/** The world, its first simulation started, and two invented catalogue tests. */
export async function recordsWorld(db: Kysely<DB>) {
  const w = await world(db);
  const started = await startSimulation(db, w.teacher, { simulationId: w.simulationId }, NOW);
  if (!started.ok) throw new Error(started.error);
  const hba1c = await catalogueTest(db, "HbA1c (invented)");
  const crp = await catalogueTest(db, "CRP (invented)");
  return { ...w, hba1c, crp };
}

/** The world {@link recordsWorld} builds. */
export type RecordsWorld = Awaited<ReturnType<typeof recordsWorld>>;

/** Registers the invented patient in `labId` as `actor` and returns its id. */
export async function patientIn(
  db: Kysely<DB>,
  actor: Person,
  labId: string,
  details: Partial<typeof PATIENT> = {},
): Promise<string> {
  const result = await registerPatient(db, actor, { labId, ...PATIENT, ...details });
  if (!result.ok) throw new Error(result.error);
  return result.value.patientId;
}

/** Records a request for `patientId` with one test and one sample `S-001` of whole blood. */
export async function requestFor(
  db: Kysely<DB>,
  actor: Person,
  labId: string,
  patientId: string,
  testIds: readonly string[],
  extra: Partial<RequestFields & { samples: NewRequest["samples"] }> = {},
) {
  const input: NewRequest = {
    kind: "patient",
    labId,
    patientId,
    requester: "Dr. Invented",
    phoneThrough: false,
    remarks: null,
    testIds,
    samples: [{ sampleNumber: "S-001", material: "whole blood" }],
    ...extra,
  };
  const result = await recordRequest(db, actor, input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/**
 * Releases every requested test of `requestId`, bypassing the service (test set-up only): a
 * tolerance and a measurement on the request's first sample per test, then the release, which
 * the database stamps with its own clock.
 */
export async function release(db: Kysely<DB>, requestId: string): Promise<void> {
  const request = await db
    .selectFrom("requests")
    .innerJoin("samples", "samples.request_id", "requests.id")
    .select(["requests.simulation_id", "requests.lab_id", "samples.id as sample_id"])
    .where("requests.id", "=", requestId)
    .orderBy("samples.created_at")
    .orderBy("samples.id")
    .executeTakeFirstOrThrow();
  const tests = await db
    .selectFrom("request_tests")
    .select("test_id")
    .where("request_id", "=", requestId)
    .execute();
  for (const { test_id } of tests) {
    const tolerance = await db
      .insertInto("lab_tolerances")
      .values({
        simulation_id: request.simulation_id,
        lab_id: request.lab_id,
        test_id,
        lower_limit: "1",
        upper_limit: "9",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const measurement = await db
      .insertInto("measurements")
      .values({
        simulation_id: request.simulation_id,
        lab_id: request.lab_id,
        request_id: requestId,
        test_id,
        sample_id: request.sample_id,
        value: "5.5",
        source: "manual",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await db
      .updateTable("request_tests")
      .set({ released_measurement_id: measurement.id, released_tolerance_id: tolerance.id })
      .where("request_id", "=", requestId)
      .where("test_id", "=", test_id)
      .execute();
  }
}
