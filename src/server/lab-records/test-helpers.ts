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

/** Marks every requested test of `requestId` released, as #270 will (test set-up only). */
export async function release(db: Kysely<DB>, requestId: string): Promise<void> {
  await db
    .updateTable("request_tests")
    .set({ released_at: NOW })
    .where("request_id", "=", requestId)
    .execute();
}
