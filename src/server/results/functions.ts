// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of a lab's measurements and results (S14, S15, #270); bodies run on the
// server. Each requires its app role first, then parses its input with Zod; the service checks the
// lab membership or the simulation's teacher row on the session user in SQL (S10, D11). No
// function here selects a correct value, an accuracy limit or an accuracy status (Q-SIM-1).
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
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
    const result = await releaseResult(getDb(), context.user, data);
    if (!result.ok) return result;
    // TODO(#148): write `result.value.record` to the patient's record as Final, after
    // `ensurePatientEhr` of #364; a control request has no record (S16).
    return { ok: true as const, value: { releasedAt: result.value.releasedAt } };
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
