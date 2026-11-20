// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The EHR of a registered patient against the real FerroEHR of compose.dev.yaml (#147, S11, S10,
// Q-PRIV-1): ITS-REST 1.1.0, EHR API, "Get EHR by subject id" and "Create EHR", with eduLIMS's
// own client credentials. Like ferro-stack.test.ts it skips itself locally when FerroEHR does not
// answer, and fails in the CI integration lane (EDULIMS_IT_REQUIRE_STACK=1). The dev realm must
// hold the scope system/composition-*.cr (docker/keycloak/edulims-realm.json). The last suite
// proves what that wildcard does not reach (#364): a commit outside the client's `writes` and an
// EHR_STATUS update, as raw requests the client deliberately cannot make.
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

const BASE = `${FERROEHR}/ferroehr/rest/openehr/v1`;
const TOKEN_URL = `${KEYCLOAK}/realms/edulims/protocol/openid-connect/token`;
/** The test-only template of docker/ferroehr/test-definitions, which `writes` does not list. */
const FOREIGN_TEMPLATE = "eduLIMS-test-foreign.v1";
const FOREIGN_ARCHETYPE = "openEHR-EHR-COMPOSITION.edulims_test_foreign.v1";

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

/** Returns eduLIMS's own access token with the scopes the server asks for. */
async function clientToken(): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: "edulims-ferroehr",
      client_secret: "edulims-dev-ferroehr-secret",
      scope: "system/template-*.r system/composition-*.cr",
    }),
  });
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("access_token" in body)) {
    throw new Error(`no token: ${response.status}`);
  }
  return String(body.access_token);
}

/** Creates a fresh EHR in eduLIMS's namespace and returns its id. */
async function freshEhr(): Promise<string> {
  const created = await client.createEhr(ehrStatusFor(freshSubject()));
  if (!created.ok || created.value.outcome !== "created") throw new Error("no fresh EHR");
  return created.value.ehr.ehr_id.value;
}

/** An empty COMPOSITION of `templateId`, invented, with no clinical content. */
function emptyComposition(templateId: string) {
  const code = (terminology: string, codeString: string) => ({
    _type: "CODE_PHRASE",
    terminology_id: { _type: "TERMINOLOGY_ID", value: terminology },
    code_string: codeString,
  });
  return {
    _type: "COMPOSITION",
    archetype_node_id: FOREIGN_ARCHETYPE,
    archetype_details: {
      _type: "ARCHETYPED",
      archetype_id: { _type: "ARCHETYPE_ID", value: FOREIGN_ARCHETYPE },
      template_id: { _type: "TEMPLATE_ID", value: templateId },
      rm_version: "1.1.0",
    },
    name: { _type: "DV_TEXT", value: "Test foreign" },
    language: code("ISO_639-1", "en"),
    territory: code("ISO_3166-1", "NL"),
    category: { _type: "DV_CODED_TEXT", value: "event", defining_code: code("openehr", "433") },
    composer: { _type: "PARTY_SELF" },
  };
}

/** POSTs `body` as a COMPOSITION into `ehrId` with the client's token. */
async function postComposition(ehrId: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}/ehr/${ehrId}/composition`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await clientToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Returns the openEHR error code of a problem body: the anchor of its `type`. */
async function problemCode(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("type" in body)) return undefined;
  return String(body.type).split("#")[1];
}

const templates = reachable ? await client.listTemplates() : undefined;
const foreignLoaded =
  templates?.ok === true &&
  templates.value.some((template) => template.template_id === FOREIGN_TEMPLATE);
if (reachable && !foreignLoaded && !REQUIRED) {
  console.warn(
    `The writes-limit case is skipped: the running FerroEHR lacks ${FOREIGN_TEMPLATE}. ` +
      "Recreate the dev stack (its ferroehr-definitions one-shot loads it) to run it.",
  );
}

describe.skipIf(!reachable && !REQUIRED)(
  "what the composition wildcard does not reach (#364)",
  () => {
    it.skipIf(!foreignLoaded && !REQUIRED)(
      `refuses a COMPOSITION of ${FOREIGN_TEMPLATE}, outside the client's writes, with 403`,
      async () => {
        const response = await postComposition(
          await freshEhr(),
          emptyComposition(FOREIGN_TEMPLATE),
        );
        await response.body?.cancel();
        expect(response.status).toBe(403);
        expect(response.headers.get("Location")).toBeNull();
      },
    );

    it("refuses a COMPOSITION of a template FerroEHR does not hold with 422, storing nothing", async () => {
      const response = await postComposition(
        await freshEhr(),
        emptyComposition("eduLIMS-test-unknown.v1"),
      );
      expect(response.status).toBe(422);
      expect(await problemCode(response)).toBe("content-invalid");
      expect(response.headers.get("Location")).toBeNull();
    });

    it("refuses an EHR_STATUS update with 403", async () => {
      const subject = freshSubject();
      const created = await client.createEhr(ehrStatusFor(subject));
      if (!created.ok || created.value.outcome !== "created") expect.fail("no fresh EHR");
      const ehrId = created.value.ehr.ehr_id.value;
      const token = await clientToken();
      const current = await fetch(`${BASE}/ehr/${ehrId}/ehr_status`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      await current.body?.cancel();
      expect(current.status).toBe(200);
      const etag = current.headers.get("ETag");
      if (etag === null) expect.fail("no ETag on the EHR_STATUS");
      const response = await fetch(`${BASE}/ehr/${ehrId}/ehr_status`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "If-Match": etag,
        },
        body: JSON.stringify({ ...ehrStatusFor(subject), is_queryable: false }),
      });
      await response.body?.cancel();
      expect(response.status).toBe(403);
    });
  },
);
