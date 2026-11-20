// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of a lab's measurements and results (S14, S15, #270); bodies run on the
// server. Each requires its app role first, then parses its input with Zod; the service checks the
// lab membership or the simulation's teacher row on the session user in SQL (S10, D11). No
// function here selects a correct value, an accuracy limit or an accuracy status (Q-SIM-1).
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { getEnv } from "../env.ts";
import { requireRole } from "../middleware.ts";
import { getOpenEhrClient, labResultWriteSettings } from "../openehr/index.ts";
import { ensureReleaseEhr, type ResultEhrState, writeReleasedResult } from "./ehr-write.ts";
import { recordManualMeasurement } from "./measurements.ts";
import { readStudentResults, readTeacherResults } from "./queries.ts";
import { releaseResult } from "./release.ts";
import { labResultsInput, recordMeasurementInput, releaseResultInput } from "./schemas.ts";

const student = requireRole("student");
const teacher = requireRole("teacher");

/** Returns the measurements and results of the student's own lab; `notFound` for another lab. */
export const getMyResultsFn = createServerFn({ method: "GET" })
  .middleware([student])
  .validator(labResultsInput)
  .handler(async ({ data, context }) => {
    const results = await readStudentResults(getDb(), context.user, data.labId);
    if (!results) throw notFound();
    return results;
  });

/** Records a measurement entered by hand in the student's own lab (S14). */
export const recordMeasurementFn = createServerFn({ method: "POST" })
  .middleware([student])
  .validator(recordMeasurementInput)
  .handler(({ data, context }) => recordManualMeasurement(getDb(), context.user, data));

/** Releases one measurement as the result; the server takes the time of release (S15). */
export const releaseResultFn = createServerFn({ method: "POST" })
  .middleware([student])
  .validator(releaseResultInput)
  .handler(async ({ data, context }) => {
    const db = getDb();
    const client = getOpenEhrClient();
    const ready = await ensureReleaseEhr(db, client, context.user, data);
    if (!ready.ok) return ready;
    const result = await releaseResult(db, context.user, data);
    if (!result.ok) return result;
    // NOTE: #148; the release has committed, so a FerroEHR failure leaves the write pending for
    // the retry schedule, and the team learns only that it is pending (a control has none, S16).
    const { record } = result.value;
    const ehr: ResultEhrState =
      record === null
        ? "none"
        : await writeReleasedResult(
            { db, client, settings: labResultWriteSettings(getEnv()) },
            record.measurementId,
          );
    return { ok: true as const, value: { releasedAt: result.value.releasedAt, ehr } };
  });

/** Returns a lab's measurements and results for its teachers; `notFound` unless taught. */
export const getLabResultsFn = createServerFn({ method: "GET" })
  .middleware([teacher])
  .validator(labResultsInput)
  .handler(async ({ data, context }) => {
    const results = await readTeacherResults(getDb(), context.user, data.labId);
    if (!results) throw notFound();
    return results;
  });
