// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Recording and correcting a request from the paper form (S12, S16). A request is for a patient
// of the team's lab, or for a control sample with no patient. It names catalogue tests and comes
// with samples, each with the sample number and material of the form and a lab number from
// eduLIMS. The time of entry is the database clock of the storing transaction and never changes
// (G-01, Q-SIM-2); a correction is allowed until the first result of the request is released.
import "@tanstack/react-start/server-only";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  type NotOfferedTest,
  parsePatientId,
  parseRequestId,
  type RequestId,
  type RequestKind,
  type SampleId,
} from "../../lib/lab-records.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  done,
  logRecordsProbe,
  type RecordsActor,
  type RecordsResult,
  refused,
  withWorkingLab,
} from "./access.ts";
import { type CorrectionChange, plainChanges, recordCorrection } from "./corrections.ts";
import { insertSample } from "./lab-number.ts";
import { notOfferedOf, replaceNotOffered, sameNotOffered } from "./not-offered.ts";
import type { CorrectionOutcome } from "./patients.ts";

/** One sample of a request as the form gives it. */
export interface SampleInput {
  sampleNumber: string;
  material: string;
}

/** The fields of a request a team types from the form, apart from its patient. */
export interface RequestFields {
  requester: string | null;
  phoneThrough: boolean;
  remarks: string | null;
  testIds: readonly string[];
  /** The tests the form asks for that the lab does not offer (#398); left out: none, or unchanged. */
  notOffered?: readonly NotOfferedTest[] | undefined;
}

/** A new request: for a patient of the lab, or for a control sample with no patient (S16). */
export type NewRequest = { labId: string; samples: readonly SampleInput[] } & RequestFields &
  ({ kind: "patient"; patientId: string } | { kind: "control" });

/** A recorded request: its id, its time of entry and the lab number of each sample. */
export interface RecordedRequest {
  requestId: RequestId;
  enteredAt: string;
  samples: { id: SampleId; sampleNumber: string; labNumber: string }[];
}

/**
 * Locks the catalogue tests of `ids` `FOR SHARE` in id order and refuses an unknown test
 * (`test_not_found`) and a retired one (`test_retired`), unless `kept` holds it: a retired test
 * a request already names may stay (D9). A catalogue edit holds its test `FOR UPDATE`, so the
 * two serialise (#268, security note from #319).
 */
async function testRefusal(
  trx: Transaction<DB>,
  ids: readonly string[],
  kept: ReadonlySet<string> = new Set(),
): Promise<"test_not_found" | "test_retired" | null> {
  if (ids.length === 0) return null;
  const tests = await trx
    .selectFrom("catalogue_tests")
    .select(["id", "retired_at"])
    .where("id", "in", ids)
    .orderBy("id")
    .forShare()
    .execute();
  if (tests.length !== ids.length) return "test_not_found";
  if (tests.some((test) => test.retired_at !== null && !kept.has(test.id))) return "test_retired";
  return null;
}

/**
 * Records a request in the actor's lab (S12, S16): the request with its time of entry, its tests
 * and its samples, each with a fresh lab number, in one transaction. A patient of another lab is
 * `patient_not_found`, logged. Logs `lab_request_recorded` with the request's id and the number
 * of samples.
 */
export function recordRequest(
  db: Kysely<DB>,
  actor: RecordsActor,
  input: NewRequest,
): Promise<RecordsResult<RecordedRequest>> {
  return withWorkingLab(db, actor, input.labId, async (trx, lab) => {
    let patientId: string | null = null;
    if (input.kind === "patient") {
      const id = parsePatientId(input.patientId);
      const patient =
        id === null
          ? undefined
          : await trx
              .selectFrom("patients")
              .select("id")
              .where("id", "=", id)
              .where("lab_id", "=", lab.labId)
              .executeTakeFirst();
      if (!patient) {
        logRecordsProbe(actor.id, "patient", input.patientId);
        return refused("patient_not_found");
      }
      patientId = patient.id;
    }
    const testIds = [...new Set(input.testIds)];
    const refusal = await testRefusal(trx, testIds);
    if (refusal !== null) return refused(refusal);
    const row = await trx
      .insertInto("requests")
      .values({
        simulation_id: lab.simulationId,
        lab_id: lab.labId,
        kind: input.kind,
        patient_id: patientId,
        requester: input.requester,
        phone_through: input.phoneThrough,
        remarks: input.remarks,
        created_by: actor.id,
        updated_by: actor.id,
      })
      .returning(["id", "entered_at"])
      .executeTakeFirstOrThrow();
    const requestId = parseRequestId(row.id);
    if (requestId === null) throw new Error("the database returned a malformed request id");
    await trx
      .insertInto("request_tests")
      .values(testIds.map((testId) => ({ request_id: requestId, test_id: testId })))
      .execute();
    await replaceNotOffered(trx, lab.labId, requestId, input.notOffered ?? []);
    const samples: RecordedRequest["samples"] = [];
    for (const sample of input.samples) {
      const stored = await insertSample(trx, {
        simulationId: lab.simulationId,
        labId: lab.labId,
        requestId,
        sampleNumber: sample.sampleNumber,
        material: sample.material,
        actorId: actor.id,
      });
      samples.push({
        id: stored.id,
        sampleNumber: sample.sampleNumber,
        labNumber: stored.labNumber,
      });
    }
    await recordAudit(trx, {
      action: "lab_request_recorded",
      actor: { type: "user", id: actor.id },
      target: { type: "lab", id: lab.labId },
      outcome: "success",
      metadata: { lab_request_id: requestId, count: samples.length },
    });
    return done({ requestId, enteredAt: row.entered_at.toISOString(), samples });
  });
}

/** A correction of a request: its fields, and its samples (an id to change one, none to add). */
export type RequestCorrection = { labId: string; requestId: string } & RequestFields & {
    samples: readonly (SampleInput & { sampleId?: string | undefined })[];
  };

/** Returns the sorted copy of `ids`. */
function sorted(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Returns the sample changes of a correction, or the first sample id the request does not hold. */
function sampleChanges(
  stored: readonly { id: string; sample_number: string; material: string }[],
  samples: RequestCorrection["samples"],
): CorrectionChange[] | { missing: string } {
  const byId = new Map(stored.map((sample) => [sample.id, sample]));
  const changes: CorrectionChange[] = [];
  for (const sample of samples) {
    if (sample.sampleId === undefined) continue;
    const current = byId.get(sample.sampleId);
    if (!current) return { missing: sample.sampleId };
    if (current.sample_number !== sample.sampleNumber) {
      changes.push({
        field: "sample_number",
        sample_id: current.id,
        before: current.sample_number,
        after: sample.sampleNumber,
      });
    }
    if (current.material !== sample.material) {
      changes.push({
        field: "material",
        sample_id: current.id,
        before: current.material,
        after: sample.material,
      });
    }
  }
  return changes;
}

/**
 * Corrects a request of the actor's lab (S12): its requester, the phone-through flag, the
 * remarks, a test it adds, the sample number and material of a sample, and a new sample (a second
 * tube) with a fresh lab number. A sample or a requested test is never removed (`test_removed`)
 * and the time of entry never changes.
 * Refused once a result of the request is released (`released`, logged). The changes are
 * written with a correction row and logged as `lab_request_corrected` with ids.
 */
export function correctRequest(
  db: Kysely<DB>,
  actor: RecordsActor,
  input: RequestCorrection,
): Promise<RecordsResult<CorrectionOutcome>> {
  return withWorkingLab(db, actor, input.labId, async (trx, lab) => {
    const id = parseRequestId(input.requestId);
    const request =
      id === null
        ? undefined
        : await trx
            .selectFrom("requests")
            .select(["id", "kind", "requester", "phone_through", "remarks"])
            .where("id", "=", id)
            .where("lab_id", "=", lab.labId)
            .forUpdate()
            .executeTakeFirst();
    if (!request || id === null) {
      logRecordsProbe(actor.id, "request", input.requestId);
      return refused("request_not_found");
    }
    const event = {
      action: "lab_request_corrected",
      actor: { type: "user", id: actor.id },
      target: { type: "lab", id: lab.labId },
      metadata: { lab_request_id: id },
    } as const;
    const tests = await trx
      .selectFrom("request_tests")
      .select(["test_id", "released_at"])
      .where("request_id", "=", id)
      .execute();
    if (tests.some((test) => test.released_at !== null)) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "released" });
      return refused("released");
    }
    if (kindOf(request.kind) === "patient" && input.requester === null) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "requester_required" });
      return refused("requester_required");
    }
    const before = new Set(tests.map((test) => test.test_id));
    const after = new Set(input.testIds);
    const refusal = await testRefusal(trx, [...after], before);
    if (refusal !== null) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: refusal });
      return refused(refusal);
    }
    // NOTE: S12, S14 (maintainer on #268, 2026-11-20); a correction never removes a requested
    // test, so a measurement always keeps the test it belongs to.
    if ([...before].some((testId) => !after.has(testId))) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "test_removed" });
      return refused("test_removed");
    }
    const storedSamples = await trx
      .selectFrom("samples")
      .select(["id", "sample_number", "material"])
      .where("request_id", "=", id)
      .orderBy("created_at")
      .orderBy("id")
      .forUpdate()
      .execute();
    const changedSamples = sampleChanges(storedSamples, input.samples);
    if (!Array.isArray(changedSamples)) {
      logRecordsProbe(actor.id, "sample", changedSamples.missing);
      return refused("sample_not_found");
    }
    const changes: CorrectionChange[] = plainChanges(
      ["requester", "phone_through", "remarks"],
      request,
      { requester: input.requester, phone_through: input.phoneThrough, remarks: input.remarks },
    );
    const testsBefore = sorted(before);
    const testsAfter = sorted(after);
    if (testsBefore.join() !== testsAfter.join()) {
      changes.push({ field: "tests", before: testsBefore, after: testsAfter });
    }
    const notOfferedBefore = (await notOfferedOf(trx, [id])).get(id) ?? [];
    const notOfferedAfter = input.notOffered;
    if (notOfferedAfter !== undefined && !sameNotOffered(notOfferedBefore, notOfferedAfter)) {
      changes.push({
        field: "not_offered",
        before: notOfferedBefore,
        after: notOfferedAfter.map(({ name, remark }) => ({ name, remark })),
      });
      await replaceNotOffered(trx, lab.labId, id, notOfferedAfter);
    }
    changes.push(...changedSamples);
    for (const sample of input.samples) {
      if (sample.sampleId !== undefined) continue;
      const stored = await insertSample(trx, {
        simulationId: lab.simulationId,
        labId: lab.labId,
        requestId: id,
        sampleNumber: sample.sampleNumber,
        material: sample.material,
        actorId: actor.id,
      });
      changes.push({
        field: "sample_added",
        sample_id: stored.id,
        sample_number: sample.sampleNumber,
        material: sample.material,
        lab_number: stored.labNumber,
      });
    }
    if (changes.length === 0) return done({ changed: 0 });
    await applyRequestChanges(trx, actor.id, id, input, before, after);
    await recordCorrection(trx, lab, { kind: "request", requestId: id }, actor.id, changes);
    await recordAudit(trx, { ...event, outcome: "success" });
    return done({ changed: changes.length });
  });
}

/** Returns the stored kind of a request as a {@link RequestKind}. */
function kindOf(value: string): RequestKind {
  if (value === "patient" || value === "control") return value;
  throw new Error("the database holds an unknown request kind");
}

/** Writes the request's fields, its added tests and the changed samples. The new samples are in. */
async function applyRequestChanges(
  trx: Transaction<DB>,
  actorId: string,
  requestId: string,
  input: RequestCorrection,
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): Promise<void> {
  await trx
    .updateTable("requests")
    .set({
      requester: input.requester,
      phone_through: input.phoneThrough,
      remarks: input.remarks,
      updated_by: actorId,
      updated_at: sql`now()`,
    })
    .where("id", "=", requestId)
    .execute();
  const added = [...after].filter((testId) => !before.has(testId));
  if (added.length > 0) {
    await trx
      .insertInto("request_tests")
      .values(added.map((testId) => ({ request_id: requestId, test_id: testId })))
      .execute();
  }
  for (const sample of input.samples) {
    if (sample.sampleId === undefined) continue;
    await trx
      .updateTable("samples")
      .set({
        sample_number: sample.sampleNumber,
        material: sample.material,
        updated_by: actorId,
        updated_at: sql`now()`,
      })
      .where("id", "=", sample.sampleId)
      .where("request_id", "=", requestId)
      .execute();
  }
}
