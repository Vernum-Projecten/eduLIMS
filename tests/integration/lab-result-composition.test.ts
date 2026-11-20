// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A released result in the patient's record against the real FerroEHR of compose.dev.yaml (#148,
// S15, Q-COMP-1, Q-TRACE-1, Q-PRIV-1): ITS-REST 1.1.0, EHR API, "Create CONTRIBUTION" with a
// supplied `uid`, "Get CONTRIBUTION" and "Get COMPOSITION", with eduLIMS's own client
// credentials. FerroEHR validates every composition against eduLIMS-lab.v1, so a write that lands
// passed it. Like patient-ehr.test.ts it skips itself locally when FerroEHR does not answer, and
// fails in the CI integration lane (EDULIMS_IT_REQUIRE_STACK=1). Values are invented (Q-PRIV-4).
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { parseRequestId } from "../../src/lib/lab-records.ts";
import { parseMeasurementId } from "../../src/lib/results.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { createTestDb } from "../../src/server/db/test-db.ts";
import { type EhrId, resolveSubjectEhr } from "../../src/server/lab-records/patient-ehr.ts";
import { finalResultContributionUid } from "../../src/server/openehr/contribution.ts";
import { EHR_SUBJECT_NAMESPACE } from "../../src/server/openehr/ehr.ts";
import { failure } from "../../src/server/openehr/errors.ts";
import { createOpenEhrClient, type OpenEhrClient } from "../../src/server/openehr/index.ts";
import type { FinalLabResult } from "../../src/server/openehr/lab-result.ts";
import {
  type LabResultWriteSettings,
  writeFinalLabResult,
} from "../../src/server/openehr/lab-result-writer.ts";
import {
  ensureReleaseEhr,
  type ResultWriteDeps,
  runPendingResultWrites,
  writeReleasedResult,
} from "../../src/server/results/ehr-write.ts";
import { releaseResult } from "../../src/server/results/release.ts";
import { measure, resultsWorld } from "../../src/server/results/test-helpers.ts";

const port = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
const KEYCLOAK = `http://localhost:${port("EDULIMS_DEV_KEYCLOAK_PORT", "8180")}`;
const FERROEHR = `http://localhost:${port("EDULIMS_DEV_FERROEHR_PORT", "8080")}`;
const REQUIRED = process.env["EDULIMS_IT_REQUIRE_STACK"] === "1";

const client = createOpenEhrClient(
  {
    baseUrl: new URL(`${FERROEHR}/ferroehr/rest/openehr/v1`),
    tokenUrl: new URL(`${KEYCLOAK}/realms/edulims/protocol/openid-connect/token`),
    clientId: "edulims-ferroehr",
    clientSecret: "edulims-dev-ferroehr-secret",
    scope: "system/template-*.r system/composition-*.cr",
  },
  { fetch: (url, init) => fetch(url, init), nowMs: () => Date.now() },
);

/** The facility compose.dev.yaml declares for eduLIMS's system client. */
const SETTINGS: LabResultWriteSettings = {
  facility: { issuer: "urn:example:edulims-dev-facility", id: "dev-lab" },
  territory: "NL",
  committerName: "edulims-ferroehr",
};
const ANALYSER = { kind: "afinion_2", serialNumber: "AF2-TEST-0001" } as const;

/** The client, with a create that commits and then answers a timeout, as a lost answer does. */
const lostAnswer: OpenEhrClient = {
  ...client,
  async createContribution(ehrId, body) {
    await client.createContribution(ehrId, body);
    return failure({
      kind: "timeout",
      target: "ferroehr",
      cause: new DOMException("the answer was lost", "TimeoutError"),
    });
  },
};

const reachable = (await client.options()).ok;
if (!reachable && !REQUIRED) {
  console.warn("Lab result stack test skipped: FerroEHR does not answer. Start pnpm dev:db.");
}

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function freshEhr(): Promise<EhrId> {
  const resolved = await resolveSubjectEhr(client, {
    id: randomUUID(),
    namespace: EHR_SUBJECT_NAMESPACE,
  });
  if (!resolved.ok) throw new Error(`no EHR: ${resolved.error.kind}`);
  // A test-only brand: the id FerroEHR just gave the new EHR.
  return resolved.value as EhrId;
}

function result(ehrId: EhrId): FinalLabResult {
  const measurementId = parseMeasurementId(randomUUID());
  const requestId = parseRequestId(randomUUID());
  if (measurementId === null || requestId === null) throw new Error("no ids");
  return {
    ehrId,
    measurementId,
    requestId,
    requester: "Invented GP practice",
    sample: { labNumber: "1234567890", sampleNumber: "S-001", material: "whole blood" },
    test: { name: "HbA1c (invented)", analyte: "HbA1c", unit: "mmol/mol" },
    value: "48.50",
    measuredAt: "2026-11-20T09:15:00.000Z",
    device: ANALYSER,
    releasedAt: "2026-11-20T09:20:00.000Z",
  };
}

/** Returns the text of the composition FerroEHR holds at `versionUid`. */
async function readBack(ehrId: string, versionUid: string): Promise<string> {
  const read = await client.getComposition(ehrId, versionUid);
  if (!read.ok) expect.fail(`read failed: ${read.error.kind}`);
  if (read.value === null) expect.fail("the composition is not there");
  expect(read.value.archetype_details.template_id.value).toBe("eduLIMS-lab.v1");
  return JSON.stringify(read.value);
}

describe.skipIf(!reachable && !REQUIRED)("the writer against FerroEHR (#148)", () => {
  it("writes the Final result, and FerroEHR holds it as written", async () => {
    const ehrId = await freshEhr();
    const input = result(ehrId);
    const written = await writeFinalLabResult(client, input, SETTINGS);
    if (written.outcome !== "written") expect.fail(JSON.stringify(written.error));
    expect(written.committed).toBe("now");
    const text = await readBack(ehrId, written.versionUid);
    for (const fact of ['"Final"', '"at0018"', '"1234567890"', '"S-001"', input.requestId]) {
      expect(text).toContain(fact);
    }
    expect(text).toContain('"magnitude":48.5');
  });

  it("writes a result entered by hand under the fixed device identity, with no person", async () => {
    const ehrId = await freshEhr();
    const written = await writeFinalLabResult(
      client,
      { ...result(ehrId), device: { kind: "manual" } },
      SETTINGS,
    );
    if (written.outcome !== "written") expect.fail(JSON.stringify(written.error));
    const text = await readBack(ehrId, written.versionUid);
    expect(text).toContain('"eduLIMS manual entry"');
    expect(text).toContain('"id":"manual"');
  });

  it("answers a retry after the commit with the same version: no second composition", async () => {
    const ehrId = await freshEhr();
    const input = result(ehrId);
    const first = await writeFinalLabResult(client, input, SETTINGS);
    const second = await writeFinalLabResult(client, input, SETTINGS);
    expect(first).toMatchObject({ outcome: "written", committed: "now" });
    expect(second).toEqual({ ...first, committed: "before" });
    const held = await client.getContribution(
      ehrId,
      finalResultContributionUid(input.measurementId),
    );
    if (!held.ok || held.value === null) expect.fail("the contribution is not there");
    expect(held.value.versions).toHaveLength(1);
  });

  it("finds a write whose answer was lost on the retry: no second composition", async () => {
    const ehrId = await freshEhr();
    const input = result(ehrId);
    const lost = await writeFinalLabResult(lostAnswer, input, SETTINGS);
    expect(lost).toMatchObject({ outcome: "failed", error: { kind: "openehr" } });
    const retry = await writeFinalLabResult(client, input, SETTINGS);
    expect(retry).toMatchObject({ outcome: "written", committed: "before" });
  });
});

describe.skipIf(!reachable && !REQUIRED)("a release end to end (#148, S15)", () => {
  /** A results world whose patient gets its real EHR through the gate before the release. */
  async function world() {
    const database = await createTestDb();
    db = database;
    const w = await resultsWorld(database);
    await database.updateTable("patients").set({ ehr_id: null }).execute();
    return { database, w };
  }

  const deps = (database: Kysely<DB>, using: OpenEhrClient): ResultWriteDeps => ({
    db: database,
    client: using,
    settings: SETTINGS,
    // NOTE: #158 and #152 give a measurement its analyser; this stands in for that lookup.
    resolveDevice: () => ANALYSER,
  });

  async function release(database: Kysely<DB>, w: Awaited<ReturnType<typeof world>>["w"]) {
    const measurementId = await measure(database, w, "5.3");
    const asked = {
      labId: w.labId,
      requestId: w.requestId,
      testId: w.hba1c,
      measurementId,
      toleranceId: w.toleranceId,
    };
    expect(await ensureReleaseEhr(database, client, w.student, asked)).toMatchObject({ ok: true });
    const released = await releaseResult(database, w.student, asked);
    if (!released.ok) expect.fail(released.error);
    const id = parseMeasurementId(measurementId);
    if (id === null) throw new Error("bad measurement id");
    return id;
  }

  async function written(database: Kysely<DB>, measurementId: string) {
    const row = await database
      .selectFrom("result_ehr_writes")
      .innerJoin("measurements", "measurements.id", "result_ehr_writes.measurement_id")
      .innerJoin("requests", "requests.id", "measurements.request_id")
      .innerJoin("patients", "patients.id", "requests.patient_id")
      .select(["result_ehr_writes.state", "result_ehr_writes.version_uid", "patients.ehr_id"])
      .where("result_ehr_writes.measurement_id", "=", measurementId)
      .executeTakeFirstOrThrow();
    if (row.version_uid === null || row.ehr_id === null) expect.fail(`still ${row.state}`);
    return { versionUid: row.version_uid, ehrId: row.ehr_id };
  }

  it("resolves the EHR, releases, writes the result and reads it back", async () => {
    const { database, w } = await world();
    const id = await release(database, w);
    expect(await writeReleasedResult(deps(database, client), id)).toBe("written");
    const { versionUid, ehrId } = await written(database, id);
    const text = await readBack(ehrId, versionUid);
    expect(text).toContain('"Final"');
    for (const secret of [w.student.id, w.student.email, w.toleranceId]) {
      expect(text).not.toContain(secret);
    }
  });

  it("writes a measurement entered by hand with the default device lookup", async () => {
    const { database, w } = await world();
    const id = await release(database, w);
    const plain: ResultWriteDeps = { db: database, client, settings: SETTINGS };
    expect(await writeReleasedResult(plain, id)).toBe("written");
    const { versionUid, ehrId } = await written(database, id);
    expect(await readBack(ehrId, versionUid)).toContain('"eduLIMS manual entry"');
  });

  it("retries a write whose answer was lost and finds the one composition", async () => {
    const { database, w } = await world();
    const id = await release(database, w);
    expect(await writeReleasedResult(deps(database, lostAnswer), id)).toBe("pending");
    await database
      .updateTable("result_ehr_writes")
      .set({ next_attempt_at: new Date(Date.now() - 1_000) })
      .execute();
    expect(await runPendingResultWrites(deps(database, client))).toEqual({
      written: 1,
      pending: 0,
    });
    const { versionUid, ehrId } = await written(database, id);
    const held = await client.getContribution(ehrId, finalResultContributionUid(id));
    if (!held.ok || held.value === null) expect.fail("the contribution is not there");
    expect(held.value.versions.map((version) => version.id.value)).toEqual([versionUid]);
  });
});
