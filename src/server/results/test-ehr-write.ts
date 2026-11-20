// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared set-up of the tests of a released result's write to FerroEHR (#148): FerroEHR in memory,
// the write's dependencies, and a release in the results world. Values are invented (Q-PRIV-4).
// Test support only.
import { type Kysely, sql } from "kysely";
import { vi } from "vitest";
import { parseMeasurementId } from "../../lib/results.ts";
import type { DB } from "../db/schema.gen.ts";
import type { NewContribution } from "../openehr/contribution.ts";
import { failure, type OpenEhrResult, success } from "../openehr/errors.ts";
import type { Contribution } from "../openehr/schemas.ts";
import type { ResultWriteDeps } from "./ehr-write.ts";
import { releaseResult } from "./release.ts";
import { measure, type ResultsWorld } from "./test-helpers.ts";

export const VERSION = "01a1f79f-e2e6-713c-878c-1f1b2f8278c6::ferroehr.local::1";
export const NEW_EHR = "01a1f79f-e2d0-77ea-8eac-fe74ff33c1a9";
export const SETTINGS = {
  facility: { issuer: "urn:example:edulims-test-facility", id: "test-lab" },
  territory: "NL",
  committerName: "edulims-ferroehr",
};
export const unreachable = <T>(): OpenEhrResult<T> =>
  failure({ kind: "unreachable", target: "ferroehr", cause: new TypeError("fetch failed") });

/** A FerroEHR in memory: one contribution per uid, and EHRs created on request. */
export function ferroEhr() {
  const stored = new Map<string, NewContribution>();
  const kept = (uid: string): Contribution => ({
    uid: { value: uid },
    versions: [{ id: { value: VERSION } }],
  });
  const client = {
    getEhrBySubject: vi.fn<ResultWriteDeps["client"]["getEhrBySubject"]>(async () => success(null)),
    createEhr: vi.fn<ResultWriteDeps["client"]["createEhr"]>(async () =>
      success({ outcome: "created" as const, ehr: { ehr_id: { value: NEW_EHR } } }),
    ),
    createContribution: vi.fn<ResultWriteDeps["client"]["createContribution"]>(async (_, body) => {
      if (stored.has(body.uid.value)) return success({ outcome: "conflict" as const });
      stored.set(body.uid.value, body);
      return success({ outcome: "created" as const, contribution: kept(body.uid.value) });
    }),
    getContribution: vi.fn<ResultWriteDeps["client"]["getContribution"]>(async (_, uid) =>
      success(stored.has(uid) ? kept(uid) : null),
    ),
  };
  return { client, stored };
}

/** Deps whose analyser is known, as #158 and #152 will give a measurement its serial number. */
export function analyserDeps(
  database: Kysely<DB>,
  client: ResultWriteDeps["client"],
): ResultWriteDeps {
  return {
    db: database,
    client,
    settings: SETTINGS,
    resolveDevice: () => ({ kind: "afinion_2", serialNumber: "AF2-TEST-0001" }),
  };
}

export function input(w: ResultsWorld, measurementId: string) {
  return {
    labId: w.labId,
    requestId: w.requestId,
    testId: w.hba1c,
    measurementId,
    toleranceId: w.toleranceId,
  };
}

/** Releases a new measurement of HbA1c and returns its id. */
export async function released(database: Kysely<DB>, w: ResultsWorld, value = "5.3") {
  const id = await measure(database, w, value);
  const result = await releaseResult(database, w.student, input(w, id));
  if (!result.ok) throw new Error(result.error);
  const measurementId = parseMeasurementId(id);
  if (measurementId === null) throw new Error("bad measurement id");
  return measurementId;
}

export function writeRow(database: Kysely<DB>, measurementId: string) {
  return database
    .selectFrom("result_ehr_writes")
    .select([
      "state",
      "contribution_uid",
      "version_uid",
      "attempts",
      "last_error",
      sql<number>`extract(epoch from next_attempt_at - now())::float8`.as("pause_s"),
      "written_at",
    ])
    .where("measurement_id", "=", measurementId)
    .executeTakeFirstOrThrow();
}
