// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The EHR of a registered patient against the real FerroEHR of compose.dev.yaml (#147, S11, S10,
// Q-PRIV-1): ITS-REST 1.1.0, EHR API, "Get EHR by subject id" and "Create EHR", with eduLIMS's
// own client credentials. Like ferro-stack.test.ts it skips itself locally when FerroEHR does not
// answer, and fails in the CI integration lane (EDULIMS_IT_REQUIRE_STACK=1). The dev realm must
// hold the scope system/composition-*.cr (docker/keycloak/edulims-realm.json).
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { parsePatientId } from "../../src/lib/lab-records.ts";
import type { DB } from "../../src/server/db/schema.gen.ts";
import { createTestDb } from "../../src/server/db/test-db.ts";
import { ensurePatientEhr, resolveSubjectEhr } from "../../src/server/lab-records/patient-ehr.ts";
import { patientIn, recordsWorld } from "../../src/server/lab-records/test-helpers.ts";
import { EHR_SUBJECT_NAMESPACE, ehrStatusFor } from "../../src/server/openehr/ehr.ts";
import { createOpenEhrClient } from "../../src/server/openehr/index.ts";

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

const reachable = (await client.options()).ok;
if (!reachable && !REQUIRED) {
  console.warn("Patient EHR stack test skipped: FerroEHR does not answer. Start pnpm dev:db.");
}

/** A subject no earlier run used: a fresh UUID in eduLIMS's namespace. */
const freshSubject = () => ({ id: randomUUID(), namespace: EHR_SUBJECT_NAMESPACE });

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe.skipIf(!reachable && !REQUIRED)("the EHR of a patient in FerroEHR (#147)", () => {
  it("finds no EHR for a new subject (404)", async () => {
    expect(await client.getEhrBySubject(freshSubject())).toEqual({ ok: true, value: null });
  });

  it("creates the EHR of a new subject, then finds the same EHR by its subject", async () => {
    const subject = freshSubject();
    const created = await resolveSubjectEhr(client, subject);
    if (!created.ok) expect.fail(`resolve failed: ${created.error.kind}`);
    const found = await client.getEhrBySubject(subject);
    if (!found.ok) expect.fail(`lookup failed: ${found.error.kind}`);
    expect(found.value?.ehr_id.value).toBe(created.value);
    expect(await resolveSubjectEhr(client, subject)).toEqual(created);
  });

  it("answers a second create of the same subject with a conflict (409)", async () => {
    const subject = freshSubject();
    const first = await client.createEhr(ehrStatusFor(subject));
    expect(first).toMatchObject({ ok: true, value: { outcome: "created" } });
    expect(await client.createEhr(ehrStatusFor(subject))).toEqual({
      ok: true,
      value: { outcome: "conflict" },
    });
  });

  it("gives concurrent resolves of one subject one EHR", async () => {
    const subject = freshSubject();
    const results = await Promise.all([
      resolveSubjectEhr(client, subject),
      resolveSubjectEhr(client, subject),
      resolveSubjectEhr(client, subject),
    ]);
    const ids = results.map((result) => (result.ok ? result.value : result.error.kind));
    expect(new Set(ids).size).toBe(1);
    expect(results[0]?.ok).toBe(true);
  });

  it("gives two teams that register the same patient two EHRs, each stored once (S10)", async () => {
    db = await createTestDb();
    const w = await recordsWorld(db);
    const ours = parsePatientId(await patientIn(db, w.student, w.labId));
    const theirs = parsePatientId(await patientIn(db, w.otherLabStudent, w.otherLabId));
    if (ours === null || theirs === null) throw new Error("malformed patient id");
    const a = await ensurePatientEhr(db, client, ours);
    const b = await ensurePatientEhr(db, client, theirs);
    if (a.state !== "ready" || b.state !== "ready") expect.fail("expected two ready EHRs");
    expect(a.ehrId).not.toBe(b.ehrId);
    expect(await ensurePatientEhr(db, client, ours)).toEqual(a);
    const found = await client.getEhrBySubject({ id: theirs, namespace: EHR_SUBJECT_NAMESPACE });
    expect(found.ok && found.value?.ehr_id.value).toBe(b.ehrId);
  });
});
