// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Linking the wells of a stored upload to the lab's samples, with the results the team entered
// (S4, S10, S14, D9, #156). Every link and result is checked first, then the links, the
// measurements and the activity-log row are written in one transaction, or nothing is.
import "@tanstack/react-start/server-only";
import { type Kysely, sql, type Transaction } from "kysely";
import { parseDecimal } from "../../lib/decimal.ts";
import { parseRequestId, parseSampleId } from "../../lib/lab-records.ts";
import { plateWells, type WellId } from "../../lib/plate.ts";
import { parseLabId } from "../../lib/simulations.ts";
import { parseUploadId, type UploadId, type UploadResultRefusalCode } from "../../lib/uploads.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertStudent, logRecordsProbe } from "../lab-records/access.ts";
import { insertMeasurement } from "../results/measurements.ts";
import { logSecurityEvent } from "../security-log.ts";
import {
  findStudentLab,
  findWorkingStudentLab,
  type StudentLab,
} from "../simulations/student-access.ts";
import { toPlateWells } from "./gen5-layout.ts";
import {
  type CheckedWell,
  checkPlateLinks,
  DuplicateLabNumberError,
  ForeignSampleError,
  type WellLinkInput,
} from "./plate-links.ts";
import {
  loadUploadView,
  logUploadProbe,
  type OwnSample,
  recordUploadRefusal,
  refusedUpload,
  type UploadActor,
  type UploadOutcome,
  type UploadResultRefusal,
  type UploadView,
} from "./uploads.ts";

/** One result the team entered for a linked sample and a requested test. */
export interface EnteredResult {
  readonly labNumber: string;
  readonly testId: string;
  readonly value: string;
}

/** What a student sends to link one upload: the wells' samples and the team's results. */
export interface LinkRequest {
  readonly labId: string;
  readonly uploadId: string;
  readonly links: readonly WellLinkInput[];
  readonly results: readonly EnteredResult[];
}

/**
 * Thrown when the plate check finds a sample of another lab or a lab number twice in the
 * caller's own query: a defect, so the client gets a generic 500 and no detail (V16.5.1).
 */
export class UploadIntegrityError extends Error {
  override readonly name = "UploadIntegrityError";
  readonly kind = "upload_integrity";
}

/** A result that passed every check, ready to become a measurement. */
interface CheckedResult {
  readonly sample: OwnSample;
  readonly testId: string;
  readonly value: string;
}

/**
 * Returns the samples of the actor's own lab. The lab comes from the actor's `lab_members` row
 * in this same query, so a lab id from the client selects nothing of another lab (security
 * review of #372; V8.2.2).
 */
async function ownSamples(
  trx: Transaction<DB>,
  actorId: string,
  lab: StudentLab,
): Promise<OwnSample[]> {
  const rows = await trx
    .selectFrom("samples")
    .innerJoin("lab_members", (join) =>
      join
        .onRef("lab_members.lab_id", "=", "samples.lab_id")
        .onRef("lab_members.simulation_id", "=", "samples.simulation_id"),
    )
    .select([
      "samples.id",
      "lab_members.lab_id",
      "samples.lab_number",
      "samples.sample_number",
      "samples.request_id",
    ])
    .where("lab_members.user_id", "=", actorId)
    .where("lab_members.lab_id", "=", lab.labId)
    .orderBy("samples.id")
    .execute();
  return rows.map((row) => {
    const id = parseSampleId(row.id);
    const labId = parseLabId(row.lab_id);
    const requestId = parseRequestId(row.request_id);
    if (id === null || labId === null || requestId === null) {
      throw new Error("the database returned a malformed sample row");
    }
    return {
      id,
      labId,
      labNumber: row.lab_number,
      sampleNumber: row.sample_number,
      requestId,
    };
  });
}

/** Returns the stored wells of an upload as the plate check takes them. */
async function storedPlate(trx: Transaction<DB>, lab: StudentLab, uploadId: UploadId) {
  const rows = await trx
    .selectFrom("upload_wells")
    .select(["well", sql<string>`absorbance::text`.as("absorbance")])
    .where("upload_id", "=", uploadId)
    .where("lab_id", "=", lab.labId)
    .execute();
  const byWell = new Map(rows.map((row) => [row.well, row.absorbance]));
  const wells = toPlateWells(
    plateWells().map(({ well, row, column }) => {
      const text = byWell.get(well) ?? "";
      return { well, row, column, absorbance: { text, value: Number(text) } };
    }),
  );
  if (wells === undefined) throw new Error("a stored upload is not a full plate");
  return { wells };
}

/**
 * Returns why one entered result is refused, in this order, or `null` when it may become a
 * measurement: a second result for one sample and test, a sample no well holds, a test its
 * request lacks, a test from another source, a test eduLIMS calculates, a value that is no
 * decimal within the bounds.
 */
function judgeResult(result: {
  readonly duplicate: boolean;
  readonly sample: OwnSample | undefined;
  readonly test:
    | { readonly source: string; readonly epoch_calculated_by: string | null }
    | undefined;
  readonly value: string | null;
}): UploadResultRefusalCode | null {
  if (result.duplicate) return "result_duplicate";
  if (result.sample === undefined) return "sample_not_linked";
  if (result.test === undefined) return "test_not_requested";
  if (result.test.source !== "epoch_upload") return "not_upload_test";
  // TODO(#278): for a test eduLIMS calculates, the concentration comes from the standards and
  // blanks the team marked on the plate; until then such a test takes no entered result.
  if (result.test.epoch_calculated_by !== "team") return "calculated_by_edulims";
  if (result.value === null) return "value_invalid";
  return null;
}

/**
 * Checks the results the team entered against the linked wells and the requests of their
 * samples (S4, D9), and returns every refusal by index, or the checked results.
 */
async function checkResults(
  trx: Transaction<DB>,
  results: readonly EnteredResult[],
  wells: readonly CheckedWell[],
  samples: readonly OwnSample[],
): Promise<
  | { readonly ok: true; readonly results: readonly CheckedResult[] }
  | { readonly ok: false; readonly refusals: readonly UploadResultRefusal[] }
> {
  const linked = new Map<string, OwnSample>();
  const byId = new Map(samples.map((sample) => [sample.id, sample]));
  for (const { sample } of wells) {
    const own = sample === null ? undefined : byId.get(sample.id);
    if (own !== undefined) linked.set(own.labNumber, own);
  }
  const requestIds = [...new Set([...linked.values()].map((sample) => sample.requestId))];
  const requested =
    requestIds.length === 0
      ? []
      : await trx
          .selectFrom("request_tests")
          .innerJoin("catalogue_tests", "catalogue_tests.id", "request_tests.test_id")
          .select([
            "request_tests.request_id",
            "request_tests.test_id",
            "catalogue_tests.source",
            "catalogue_tests.epoch_calculated_by",
          ])
          .where("request_tests.request_id", "in", requestIds)
          .execute();
  const tests = new Map(requested.map((row) => [`${row.request_id} ${row.test_id}`, row]));
  const seen = new Set<string>();
  const refusals: UploadResultRefusal[] = [];
  const checked: CheckedResult[] = [];
  results.forEach((result, index) => {
    const key = `${result.labNumber} ${result.testId}`;
    const sample = linked.get(result.labNumber);
    const value = parseDecimal(result.value);
    const code = judgeResult({
      duplicate: seen.has(key),
      sample,
      test: sample && tests.get(`${sample.requestId} ${result.testId}`),
      value,
    });
    seen.add(key);
    if (code !== null) refusals.push({ code, index });
    else if (sample !== undefined && value !== null) {
      checked.push({ sample, testId: result.testId, value });
    }
  });
  const [first, ...rest] = refusals;
  return first === undefined
    ? { ok: true, results: checked }
    : { ok: false, refusals: [first, ...rest] };
}

/** Writes the wells' samples, grouped by sample, then marks the upload linked. */
async function storeLinks(
  trx: Transaction<DB>,
  actorId: string,
  lab: StudentLab,
  uploadId: UploadId,
  wells: readonly CheckedWell[],
): Promise<void> {
  const bySample = new Map<string, WellId[]>();
  for (const { well, sample } of wells) {
    if (sample !== null) bySample.set(sample.id, [...(bySample.get(sample.id) ?? []), well]);
  }
  for (const [sampleId, sampleWells] of bySample) {
    await trx
      .updateTable("upload_wells")
      .set({ sample_id: sampleId })
      .where("upload_id", "=", uploadId)
      .where("lab_id", "=", lab.labId)
      .where("well", "in", sampleWells)
      .execute();
  }
  await trx
    .updateTable("uploads")
    .set({ linked_at: sql`now()`, linked_by: actorId })
    .where("id", "=", uploadId)
    .where("lab_id", "=", lab.labId)
    .execute();
}

/** Logs a defect of the plate check with ids only, and returns the generic error to throw. */
function integrityFailure(actorId: string, lab: StudentLab, error: Error): UploadIntegrityError {
  logSecurityEvent("error", "upload_integrity_fail", {
    outcome: "failure",
    actor_type: "user",
    actor_id: actorId,
    target_type: "lab",
    target_id: lab.labId,
    reason: error instanceof ForeignSampleError ? "foreign_sample" : "duplicate_lab_number",
  });
  return new UploadIntegrityError("the upload could not be linked");
}

/**
 * Links the wells of one upload of the student's own lab to its samples and turns each result
 * the team entered into a measurement of source `epoch_upload` (S4, S14, D9), in one transaction
 * with an `upload_linked` row. The links of an upload are set once (`already_linked`).
 *
 * Refused as a whole, with every item in error: a well or a lab number the plate check refuses
 * (`plate_refused`), or a result for a sample no well holds, a test the sample's request lacks,
 * a test from another source or one eduLIMS calculates, a value that is no decimal, or a second
 * result for one sample and test (`results_refused`). A refusal stores nothing but its
 * `upload_validation_fail` row.
 *
 * @throws AuthError 403 without the app role student.
 * @throws UploadIntegrityError when the samples query returns a sample of another lab or a lab
 * number twice: a defect, logged with the user and lab ids.
 */
export async function linkGen5Upload(
  db: Kysely<DB>,
  actor: UploadActor,
  input: LinkRequest,
): Promise<UploadOutcome<UploadView>> {
  assertStudent(actor);
  const uploadId = parseUploadId(input.uploadId);
  if (parseLabId(input.labId) === null) {
    logRecordsProbe(actor.id, "lab", input.labId);
    return refusedUpload("not_found");
  }
  if (uploadId === null) {
    logUploadProbe(actor.id, input.uploadId);
    return refusedUpload("upload_not_found");
  }
  return db.transaction().execute(async (trx): Promise<UploadOutcome<UploadView>> => {
    const lab = await findWorkingStudentLab(trx, actor.id, input.labId);
    if (lab === null) {
      const member = await findStudentLab(trx, actor.id, input.labId);
      if (member === null) {
        logRecordsProbe(actor.id, "lab", input.labId);
        return refusedUpload("not_found");
      }
      await recordUploadRefusal(trx, actor, member, "not_running", uploadId);
      return refusedUpload("not_running");
    }
    const upload = await trx
      .selectFrom("uploads")
      .select("linked_at")
      .where("id", "=", uploadId)
      .where("lab_id", "=", lab.labId)
      .forUpdate()
      .executeTakeFirst();
    if (!upload) {
      logUploadProbe(actor.id, uploadId);
      return refusedUpload("upload_not_found");
    }
    if (upload.linked_at !== null) return refusedUpload("already_linked");
    const samples = await ownSamples(trx, actor.id, lab);
    let checked: ReturnType<typeof checkPlateLinks>;
    try {
      checked = checkPlateLinks({
        labId: lab.labId,
        plate: await storedPlate(trx, lab, uploadId),
        links: input.links,
        samples,
      });
    } catch (error) {
      if (error instanceof ForeignSampleError || error instanceof DuplicateLabNumberError) {
        throw integrityFailure(actor.id, lab, error);
      }
      throw error;
    }
    if (!checked.ok) {
      await recordUploadRefusal(trx, actor, lab, "plate_refused", uploadId);
      return { ok: false, error: "plate_refused", refusals: checked.refusals };
    }
    const results = await checkResults(trx, input.results, checked.wells, samples);
    if (!results.ok) {
      await recordUploadRefusal(trx, actor, lab, "results_refused", uploadId);
      return { ok: false, error: "results_refused", refusals: results.refusals };
    }
    await storeLinks(trx, actor.id, lab, uploadId, checked.wells);
    for (const result of results.results) {
      const stored = await insertMeasurement(trx, {
        labId: lab.labId,
        requestId: result.sample.requestId,
        testId: result.testId,
        sampleId: result.sample.id,
        value: result.value,
        source: "epoch_upload",
        recordedBy: actor.id,
        uploadId,
      });
      // NOTE: every precondition of `insertMeasurement` was checked above under the same locks,
      // so a refusal here is a defect; throwing rolls the links and the measurements back.
      if (!stored.ok) throw new Error(`a checked result was refused: ${stored.error}`);
    }
    await recordAudit(trx, {
      action: "upload_linked",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "upload", id: uploadId },
      metadata: {
        simulation_id: lab.simulationId,
        lab_id: lab.labId,
        count: results.results.length,
      },
    });
    return { ok: true, value: await loadUploadView(trx, lab.labId, uploadId) };
  });
}
