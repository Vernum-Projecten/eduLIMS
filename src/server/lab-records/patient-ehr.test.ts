// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The EHR of a registered patient (S11, S10, Q-PRIV-1, Q-TRACE-1, #147) on a real database, with
// FerroEHR replaced at the client's boundary by an in-memory EHR index: found by subject before it
// is created, one EHR under two concurrent calls in either order (the 409 path), one EHR per team's
// patient, pending and logged with ids only while FerroEHR fails, and ready on the next call.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { type PatientId, parsePatientId } from "../../lib/lab-records.ts";
import type { DB } from "../db/schema.gen.ts";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { createTestDb } from "../db/test-db.ts";
import type { CreateEhrOutcome } from "../openehr/client.ts";
import { EHR_SUBJECT_NAMESPACE, type EhrStatus, type EhrSubjectRef } from "../openehr/ehr.ts";
import { failure, type OpenEhrError, type OpenEhrResult, success } from "../openehr/errors.ts";
import type { EhrSummary } from "../openehr/schemas.ts";
import { testOpenEhrClient } from "../openehr/test-client.ts";
import { securityLines } from "../simulations/test-helpers.ts";
import { ensurePatientEhr, type PatientEhrClient, resolveSubjectEhr } from "./patient-ehr.ts";
import { PATIENT, patientIn, recordsWorld } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;
let committed: CommittedTestDb | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
  await committed?.destroy();
  committed = undefined;
});

async function open() {
  db = await createTestDb();
  return { db, w: await recordsWorld(db) };
}

const UNREACHABLE: OpenEhrError = {
  kind: "unreachable",
  target: "ferroehr",
  cause: new TypeError("fetch failed"),
};

function summary(ehrId: string): EhrSummary {
  return { ehr_id: { value: ehrId } };
}

/**
 * An in-memory FerroEHR EHR index behind the client's two EHR operations. `failNext` makes the
 * next calls fail; `holdCreates` keeps each create waiting until the test lets it go.
 */
function fakeFerroEhr() {
  const bySubject = new Map<string, string>();
  const log: string[] = [];
  const statuses: EhrStatus[] = [];
  let failures: (OpenEhrError | null)[] = [];
  let held: { release: () => void; arrived: Promise<void> }[] | null = null;
  let issued = 0;
  const key = (subject: EhrSubjectRef) => `${subject.namespace}|${subject.id}`;

  const client: PatientEhrClient = {
    async getEhrBySubject(subject): Promise<OpenEhrResult<EhrSummary | null>> {
      log.push(`get ${subject.id}`);
      const failed = failures.shift();
      if (failed) return failure(failed);
      const ehrId = bySubject.get(key(subject));
      return success(ehrId === undefined ? null : summary(ehrId));
    },
    async createEhr(status): Promise<OpenEhrResult<CreateEhrOutcome>> {
      const index = statuses.length;
      statuses.push(status);
      const gate = held?.[index];
      if (gate) await gate.arrived;
      const failed = failures.shift();
      if (failed) return failure(failed);
      const ref = status.subject.external_ref;
      const subject = { id: ref.id.value, namespace: ref.namespace };
      log.push(`create ${subject.id}`);
      if (bySubject.has(key(subject))) return success({ outcome: "conflict" });
      issued += 1;
      const ehrId = `01a1f79f-0000-7000-8000-${String(issued).padStart(12, "0")}`;
      bySubject.set(key(subject), ehrId);
      return success({ outcome: "created", ehr: summary(ehrId) });
    },
  };

  return {
    client,
    log,
    statuses,
    bySubject,
    /** Fails the next calls in turn: an error fails that call, `null` lets it through. */
    failNext(...errors: (OpenEhrError | null)[]) {
      failures = errors;
    },
    /** Holds the first `count` creates; returns a function that lets create `index` run. */
    holdCreates(count: number) {
      const gates = Array.from({ length: count }, () => {
        let release = () => {};
        const arrived = new Promise<void>((resolve) => {
          release = resolve;
        });
        return { release, arrived };
      });
      held = gates;
      return (index: number) => gates[index]?.release();
    },
  };
}

/** Waits until `count` creates have reached the fake. */
async function untilCreates(ferro: ReturnType<typeof fakeFerroEhr>, count: number) {
  for (let round = 0; round < 200 && ferro.statuses.length < count; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(ferro.statuses).toHaveLength(count);
}

function asPatientId(value: string): PatientId {
  const id = parsePatientId(value);
  if (id === null) throw new Error("not a patient id");
  return id;
}

async function storedEhrId(database: Kysely<DB>, patientId: string) {
  const row = await database
    .selectFrom("patients")
    .select("ehr_id")
    .where("id", "=", patientId)
    .executeTakeFirstOrThrow();
  return row.ehr_id;
}

describe("resolving the EHR of a subject (ITS-REST 1.1.0, EHR API)", () => {
  const subject = { id: "0190f1c2-0000-7000-8000-000000000001", namespace: EHR_SUBJECT_NAMESPACE };

  it("returns an existing subject's EHR without creating one", async () => {
    const ferro = fakeFerroEhr();
    ferro.bySubject.set(
      `${subject.namespace}|${subject.id}`,
      "01a1f79f-0000-7000-8000-00000000abcd",
    );
    const result = await resolveSubjectEhr(ferro.client, subject);
    expect(result).toEqual({ ok: true, value: "01a1f79f-0000-7000-8000-00000000abcd" });
    expect(ferro.log).toEqual([`get ${subject.id}`]);
  });

  it("creates the EHR of a new subject after a 404", async () => {
    const ferro = fakeFerroEhr();
    const result = await resolveSubjectEhr(ferro.client, subject);
    expect(result).toEqual({ ok: true, value: "01a1f79f-0000-7000-8000-000000000001" });
    expect(ferro.log).toEqual([`get ${subject.id}`, `create ${subject.id}`]);
  });

  it("reads the EHR again after a 409 and returns the one that exists", async () => {
    const ferro = fakeFerroEhr();
    const racing: PatientEhrClient = {
      getEhrBySubject: ferro.client.getEhrBySubject,
      async createEhr(status) {
        // Another call creates the EHR between this call's lookup and its create.
        ferro.bySubject.set(
          `${subject.namespace}|${subject.id}`,
          "01a1f79f-0000-7000-8000-0000000000aa",
        );
        return ferro.client.createEhr(status);
      },
    };
    const result = await resolveSubjectEhr(racing, subject);
    expect(result).toEqual({ ok: true, value: "01a1f79f-0000-7000-8000-0000000000aa" });
    expect(ferro.log).toEqual([`get ${subject.id}`, `create ${subject.id}`, `get ${subject.id}`]);
  });

  it("fails as an unusable answer when a 409 is followed by a 404", async () => {
    const vanishing: PatientEhrClient = {
      getEhrBySubject: async () => success(null),
      createEhr: async () => success({ outcome: "conflict" }),
    };
    expect(await resolveSubjectEhr(vanishing, subject)).toEqual({
      ok: false,
      error: {
        kind: "invalid_response",
        target: "ferroehr",
        status: 404,
        problem: "unexpected_shape",
      },
    });
  });

  it("returns the lookup's failure and creates nothing", async () => {
    const ferro = fakeFerroEhr();
    ferro.failNext(UNREACHABLE);
    expect(await resolveSubjectEhr(ferro.client, subject)).toEqual({
      ok: false,
      error: UNREACHABLE,
    });
    expect(ferro.statuses).toEqual([]);
  });

  it("returns the create's failure", async () => {
    const ferro = fakeFerroEhr();
    ferro.failNext(null, UNREACHABLE);
    expect(await resolveSubjectEhr(ferro.client, subject)).toEqual({
      ok: false,
      error: UNREACHABLE,
    });
  });

  it("returns the failure of the lookup after a 409", async () => {
    const ferro = fakeFerroEhr();
    ferro.bySubject.set(
      `${subject.namespace}|${subject.id}`,
      "01a1f79f-0000-7000-8000-0000000000aa",
    );
    const client: PatientEhrClient = {
      getEhrBySubject: async (asked) => {
        ferro.log.push(`get ${asked.id}`);
        return ferro.log.length === 1 ? success(null) : failure(UNREACHABLE);
      },
      createEhr: ferro.client.createEhr,
    };
    expect(await resolveSubjectEhr(client, subject)).toEqual({ ok: false, error: UNREACHABLE });
    expect(ferro.log).toEqual([`get ${subject.id}`, `create ${subject.id}`, `get ${subject.id}`]);
  });

  it("names the subject by the patient id in eduLIMS's namespace, a PARTY_SELF and nothing else", async () => {
    const ferro = fakeFerroEhr();
    await resolveSubjectEhr(ferro.client, subject);
    expect(ferro.statuses).toEqual([
      {
        _type: "EHR_STATUS",
        archetype_node_id: "openEHR-EHR-EHR_STATUS.generic.v1",
        archetype_details: {
          _type: "ARCHETYPED",
          archetype_id: { _type: "ARCHETYPE_ID", value: "openEHR-EHR-EHR_STATUS.generic.v1" },
          rm_version: "1.1.0",
        },
        name: { _type: "DV_TEXT", value: "EHR Status" },
        subject: {
          _type: "PARTY_SELF",
          external_ref: {
            _type: "PARTY_REF",
            namespace: "edulims-patient",
            type: "PERSON",
            id: { _type: "HIER_OBJECT_ID", value: subject.id },
          },
        },
        is_queryable: true,
        is_modifiable: true,
      },
    ]);
  });
});

describe("the EHR of a registered patient (S11, #147)", () => {
  it("creates the EHR once and stores its id; the next call asks FerroEHR nothing", async () => {
    const { db: database, w } = await open();
    const patientId = asPatientId(await patientIn(database, w.student, w.labId));
    const ferro = fakeFerroEhr();
    const first = await ensurePatientEhr(database, ferro.client, patientId);
    expect(first).toEqual({ state: "ready", ehrId: "01a1f79f-0000-7000-8000-000000000001" });
    expect(await storedEhrId(database, patientId)).toBe("01a1f79f-0000-7000-8000-000000000001");
    const second = await ensurePatientEhr(database, ferro.client, patientId);
    expect(second).toEqual(first);
    expect(ferro.log).toEqual([`get ${patientId}`, `create ${patientId}`]);
  });

  it("finds an EHR FerroEHR already holds for the patient and stores it without a create", async () => {
    const { db: database, w } = await open();
    const patientId = asPatientId(await patientIn(database, w.student, w.labId));
    const ferro = fakeFerroEhr();
    ferro.bySubject.set(
      `${EHR_SUBJECT_NAMESPACE}|${patientId}`,
      "01a1f79f-0000-7000-8000-0000000000ee",
    );
    const state = await ensurePatientEhr(database, ferro.client, patientId);
    expect(state).toEqual({ state: "ready", ehrId: "01a1f79f-0000-7000-8000-0000000000ee" });
    expect(ferro.log).toEqual([`get ${patientId}`]);
  });

  for (const winner of [0, 1]) {
    it(`gives two concurrent calls one EHR when create ${winner + 1} reaches FerroEHR first (409)`, async () => {
      committed = await createCommittedTestDb();
      const database = committed.db;
      const w = await recordsWorld(database);
      const patientId = asPatientId(await patientIn(database, w.student, w.labId));
      const ferro = fakeFerroEhr();
      const release = ferro.holdCreates(2);
      const calls = [
        ensurePatientEhr(database, ferro.client, patientId),
        ensurePatientEhr(database, ferro.client, patientId),
      ];
      await untilCreates(ferro, 2);
      release(winner);
      await new Promise((resolve) => setTimeout(resolve, 10));
      release(1 - winner);
      const [a, b] = await Promise.all(calls);
      expect(a).toEqual({ state: "ready", ehrId: "01a1f79f-0000-7000-8000-000000000001" });
      expect(b).toEqual(a);
      expect(ferro.bySubject.size).toBe(1);
      expect(ferro.log.filter((line) => line.startsWith("create"))).toHaveLength(2);
      expect(ferro.log.filter((line) => line.startsWith("get"))).toHaveLength(3);
      expect(await storedEhrId(database, patientId)).toBe("01a1f79f-0000-7000-8000-000000000001");
    });
  }

  it("gives two teams that register the same patient from the same form two EHRs (S10)", async () => {
    const { db: database, w } = await open();
    const ours = asPatientId(await patientIn(database, w.student, w.labId));
    const theirs = asPatientId(await patientIn(database, w.otherLabStudent, w.otherLabId));
    const ferro = fakeFerroEhr();
    const a = await ensurePatientEhr(database, ferro.client, ours);
    const b = await ensurePatientEhr(database, ferro.client, theirs);
    if (a.state !== "ready" || b.state !== "ready") throw new Error("expected two EHRs");
    expect(a.ehrId).not.toBe(b.ehrId);
    expect([...ferro.bySubject.keys()].toSorted()).toEqual(
      [`${EHR_SUBJECT_NAMESPACE}|${ours}`, `${EHR_SUBJECT_NAMESPACE}|${theirs}`].toSorted(),
    );
    // Each patient resolves to its own EHR only, whichever team asked first.
    expect(await ensurePatientEhr(database, ferro.client, ours)).toEqual(a);
    expect(await ensurePatientEhr(database, ferro.client, theirs)).toEqual(b);
  });

  it("leaves the patient pending while FerroEHR fails, and logs ids and codes only", async () => {
    const { db: database, w } = await open();
    const patientId = asPatientId(await patientIn(database, w.student, w.labId));
    const ferro = fakeFerroEhr();
    ferro.failNext(UNREACHABLE);
    let state: Awaited<ReturnType<typeof ensurePatientEhr>> | undefined;
    const lines = await securityLines(async () => {
      state = await ensurePatientEhr(database, ferro.client, patientId);
    });
    expect(state).toEqual({ state: "pending", error: UNREACHABLE });
    expect(await storedEhrId(database, patientId)).toBeNull();
    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        event: "ferroehr_ehr_pending",
        outcome: "failure",
        target_type: "patient",
        target_id: patientId,
        kind: "unreachable",
        reason: "ferroehr",
        cause: ["TypeError"],
      }),
    ]);
    const text = JSON.stringify(lines);
    for (const secret of [
      PATIENT.name,
      PATIENT.identifier,
      w.student.email,
      w.student.id,
      w.labId,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("logs a refusal's status and openEHR code", async () => {
    const { db: database, w } = await open();
    const patientId = asPatientId(await patientIn(database, w.student, w.labId));
    const ferro = fakeFerroEhr();
    ferro.failNext({ kind: "refused", target: "ferroehr", status: 422, code: "content-invalid" });
    const lines = await securityLines(() => ensurePatientEhr(database, ferro.client, patientId));
    expect(lines).toEqual([
      expect.objectContaining({ kind: "refused", status: 422, reason: "content-invalid" }),
    ]);
  });

  it("creates the pending EHR on the next call, once FerroEHR answers again", async () => {
    const { db: database, w } = await open();
    const patientId = asPatientId(await patientIn(database, w.student, w.labId));
    const ferro = fakeFerroEhr();
    ferro.failNext({
      kind: "timeout",
      target: "ferroehr",
      cause: new DOMException("t", "TimeoutError"),
    });
    await securityLines(async () => {
      expect(await ensurePatientEhr(database, ferro.client, patientId)).toMatchObject({
        state: "pending",
      });
    });
    expect(await ensurePatientEhr(database, ferro.client, patientId)).toEqual({
      state: "ready",
      ehrId: "01a1f79f-0000-7000-8000-000000000001",
    });
  });

  it("stops when the stored EHR differs from the one the subject resolves to", async () => {
    const { db: database, w } = await open();
    const patientId = asPatientId(await patientIn(database, w.student, w.labId));
    const ferro = fakeFerroEhr();
    const sneaky: PatientEhrClient = {
      ...ferro.client,
      async getEhrBySubject(subject) {
        await database
          .updateTable("patients")
          .set({ ehr_id: "01a1f79f-0000-7000-8000-0000000000ff" })
          .where("id", "=", patientId)
          .execute();
        return ferro.client.getEhrBySubject(subject);
      },
    };
    await expect(ensurePatientEhr(database, sneaky, patientId)).rejects.toThrow(
      /holds another EHR/,
    );
  });

  it("sends FerroEHR no student's or teacher's name, e-mail or id, and no lab (Q-PRIV-1)", async () => {
    const { db: database, w } = await open();
    const patientId = asPatientId(await patientIn(database, w.student, w.labId));
    const sent: string[] = [];
    const client = testOpenEhrClient(async (url, init) => {
      sent.push(
        `${init.method} ${url.href} ${String(init.body ?? "")} ${JSON.stringify([...new Headers(init.headers)])}`,
      );
      if (url.pathname.endsWith("/token")) {
        return Response.json({ access_token: "t1", token_type: "Bearer", expires_in: 300 });
      }
      if (init.method === "GET") return Response.json({ status: 404 }, { status: 404 });
      return Response.json(
        { ehr_id: { value: "01a1f79f-0000-7000-8000-000000000001" } },
        { status: 201 },
      );
    });
    expect(await ensurePatientEhr(database, client, patientId)).toMatchObject({ state: "ready" });
    const text = sent.join("\n");
    expect(sent).toHaveLength(3);
    for (const person of [w.student, w.teacher, w.otherLabStudent]) {
      expect(text).not.toContain(person.id);
      expect(text).not.toContain(person.email);
      expect(text).not.toContain(person.email.split("@")[0]);
    }
    for (const absent of [w.labId, w.simulationId, PATIENT.name, PATIENT.identifier]) {
      expect(text).not.toContain(absent);
    }
    expect(text).toContain(patientId);
  });

  it("refuses an unknown patient", async () => {
    const { db: database } = await open();
    const ferro = fakeFerroEhr();
    await expect(
      ensurePatientEhr(database, ferro.client, asPatientId("0190f1c2-0000-7000-8000-00000000dead")),
    ).rejects.toThrow(/does not exist/);
    expect(ferro.log).toEqual([]);
  });

  it("refuses a second patient with the same EHR id (patients_ehr_id_key)", async () => {
    const { db: database, w } = await open();
    const a = await patientIn(database, w.student, w.labId);
    const b = await patientIn(database, w.student, w.labId);
    const ehrId = "01a1f79f-0000-7000-8000-0000000000bb";
    await database.updateTable("patients").set({ ehr_id: ehrId }).where("id", "=", a).execute();
    await expect(
      database.updateTable("patients").set({ ehr_id: ehrId }).where("id", "=", b).execute(),
    ).rejects.toThrow(/patients_ehr_id_key/);
  });
});
