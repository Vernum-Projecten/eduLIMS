// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of patients, requests and samples (S11, S12, S16, #268); bodies run on the
// server. A student function requires the app role student first, then parses its input with
// Zod; the service checks the student's own lab membership in SQL (S10, R-01) and, for a write,
// that the simulation runs. The correction log is the teacher's: the app role teacher, then the
// teacher row of the simulation in SQL (D11). No response carries a correct value (Q-SIM-1).
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import { readCorrectionLog } from "./correction-log.ts";
import { correctPatient, registerPatient } from "./patients.ts";
import { listRequestableTests, readLabRecords } from "./queries.ts";
import { correctRequest, recordRequest } from "./requests.ts";
import {
  correctionLogInput,
  correctPatientInput,
  correctRequestInput,
  labRecordsInput,
  recordRequestInput,
  registerPatientInput,
} from "./schemas.ts";

const student = requireRole("student");
const teacher = requireRole("teacher");

/** Returns the patients and requests of the student's lab; `notFound` for another lab. */
export const getLabRecordsFn = createServerFn({ method: "GET" })
  .middleware([student])
  .validator(labRecordsInput)
  .handler(async ({ data, context }) => {
    const records = await readLabRecords(getDb(), context.user, data.labId);
    if (!records) throw notFound();
    return records;
  });

/** Returns the active catalogue tests a team can request (S12). */
export const getRequestableTestsFn = createServerFn({ method: "GET" })
  .middleware([student])
  .handler(({ context }) => listRequestableTests(getDb(), context.user));

/** Registers a patient from the form in the student's lab (S11). */
export const registerPatientFn = createServerFn({ method: "POST" })
  .middleware([student])
  .validator(registerPatientInput)
  .handler(async ({ data, context }) => {
    const result = await registerPatient(getDb(), context.user, data);
    if (!result.ok) return result;
    // TODO(#147): create the patient's EHR in FerroEHR from `result.value.ehr`.
    return { ok: true as const, value: { patientId: result.value.patientId } };
  });

/** Corrects a patient of the student's lab until its first result is released (S11). */
export const correctPatientFn = createServerFn({ method: "POST" })
  .middleware([student])
  .validator(correctPatientInput)
  .handler(({ data, context }) => correctPatient(getDb(), context.user, data));

/** Records a request with its tests and samples; the server takes the time of entry (S12, S16). */
export const recordRequestFn = createServerFn({ method: "POST" })
  .middleware([student])
  .validator(recordRequestInput)
  .handler(({ data, context }) => recordRequest(getDb(), context.user, data));

/** Corrects a request of the student's lab until its first result is released (S12). */
export const correctRequestFn = createServerFn({ method: "POST" })
  .middleware([student])
  .validator(correctRequestInput)
  .handler(({ data, context }) => correctRequest(getDb(), context.user, data));

/** Returns the correction log of a simulation; `notFound` unless the teacher teaches it. */
export const getCorrectionLogFn = createServerFn({ method: "GET" })
  .middleware([teacher])
  .validator(correctionLogInput)
  .handler(async ({ data, context }) => {
    const log = await readCorrectionLog(getDb(), context.user, data.simulationId);
    if (!log) throw notFound();
    return log;
  });
