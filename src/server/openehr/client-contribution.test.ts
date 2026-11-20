// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The contribution and composition operations of the openEHR client against FerroEHR and the
// token endpoint stubbed at the HTTP layer (testing.md): ITS-REST 1.1.0, EHR API, "Create
// CONTRIBUTION", "Get CONTRIBUTION" and "Get COMPOSITION". Requirement: S15, Q-COMP-1 (#148).
import { describe, expect, it, vi } from "vitest";
import { CONTRIBUTION_BODY_LIMIT_BYTES } from "./client.ts";
import { creationContribution } from "./contribution.ts";
import { TEST_OPENEHR_CONFIG, testOpenEhrClient } from "./test-client.ts";
import type { HttpFetch } from "./token.ts";

const BASE = TEST_OPENEHR_CONFIG.baseUrl.href;
const PROBLEMS = "https://ferroehr.eu/docs/latest/using-the-api/problems.html";
const EHR_ID = "01a1f79f-e2d0-77ea-8eac-fe74ff33c1a2";
const UID = "2ed6657d-e927-568b-95e1-2665a8aea6a2";
const VERSION = "01a1f79f-e2e6-713c-878c-1f1b2f8278c6::ferroehr.local::1";
const BODY = creationContribution(UID, { _type: "COMPOSITION" }, "edulims-ferroehr");

/** A contribution as FerroEHR 5.7.0 answers it (ITS-REST 1.1.0, `Contribution.yaml`). */
const CONTRIBUTION = {
  uid: { _type: "HIER_OBJECT_ID", value: UID },
  versions: [
    {
      _type: "OBJECT_REF",
      namespace: "local",
      type: "VERSION",
      id: { _type: "OBJECT_VERSION_ID", value: VERSION },
    },
  ],
  audit: { _type: "AUDIT_DETAILS", system_id: "ferroehr.local" },
};

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function stack(ferroehr: Handler) {
  return vi.fn<HttpFetch>(async (url, init) => {
    if (url.href === TEST_OPENEHR_CONFIG.tokenUrl.href) {
      return json({ access_token: "t1", token_type: "Bearer", expires_in: 300 });
    }
    return ferroehr(url, init);
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function problem(type: string, status: number): Response {
  return json({ type: `${PROBLEMS}#${type}`, title: "t", status, detail: "d" }, status);
}

function ferroCalls(fetch: ReturnType<typeof stack>) {
  return fetch.mock.calls
    .filter(([url]) => url.href !== TEST_OPENEHR_CONFIG.tokenUrl.href)
    .map(([url, init]) => ({
      method: init.method,
      url: url.href,
      headers: new Headers(init.headers),
      body: init.body,
    }));
}

describe("createContribution (EHR API, Create CONTRIBUTION)", () => {
  it("POSTs the contribution to the EHR with Prefer: return=representation", async () => {
    const fetch = stack(() => json(CONTRIBUTION, 201));
    const result = await testOpenEhrClient(fetch).createContribution(EHR_ID, BODY);
    expect(result).toEqual({ ok: true, value: { outcome: "created", contribution: CONTRIBUTION } });
    const [call] = ferroCalls(fetch);
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(`${BASE}/ehr/${EHR_ID}/contribution`);
    expect(call?.headers.get("Prefer")).toBe("return=representation");
    expect(call?.headers.get("Content-Type")).toBe("application/json");
    expect(call?.headers.get("Authorization")).toBe("Bearer t1");
    expect(JSON.parse(String(call?.body))).toEqual(BODY);
  });

  it("encodes the EHR id as one path segment", async () => {
    const fetch = stack(() => json(CONTRIBUTION, 201));
    await testOpenEhrClient(fetch).createContribution("a/../b", BODY);
    expect(ferroCalls(fetch)[0]?.url).toBe(`${BASE}/ehr/a%2F..%2Fb/contribution`);
  });

  it("answers a 409 as a conflict, never as an error (contribution_create.yaml)", async () => {
    const fetch = stack(() => problem("conflict", 409));
    expect(await testOpenEhrClient(fetch).createContribution(EHR_ID, BODY)).toEqual({
      ok: true,
      value: { outcome: "conflict" },
    });
  });

  it("reports a 422 as refused with its code: a defect in the mapping (Q-COMP-1)", async () => {
    const fetch = stack(() => problem("validation-failed", 422));
    expect(await testOpenEhrClient(fetch).createContribution(EHR_ID, BODY)).toEqual({
      ok: false,
      error: { kind: "refused", target: "ferroehr", status: 422, code: "validation-failed" },
    });
  });

  it("reports a 200 where a 201 belongs as an unusable answer", async () => {
    const fetch = stack(() => json(CONTRIBUTION, 200));
    expect(await testOpenEhrClient(fetch).createContribution(EHR_ID, BODY)).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", status: 200, problem: "unexpected_shape" },
    });
  });

  it.each([
    ["no versions", { ...CONTRIBUTION, versions: [] }],
    [
      "a version id that is no OBJECT_VERSION_ID",
      { ...CONTRIBUTION, versions: [{ id: { value: "x" } }] },
    ],
    ["a uid that is no UUID", { ...CONTRIBUTION, uid: { value: "x" } }],
  ])("reports a contribution with %s as an unusable answer", async (_, body) => {
    const fetch = stack(() => json(body, 201));
    expect(await testOpenEhrClient(fetch).createContribution(EHR_ID, BODY)).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", problem: "unexpected_shape" },
    });
  });

  it("reports an answer over the body cap as too large", async () => {
    const fetch = stack(
      () => new Response("x".repeat(CONTRIBUTION_BODY_LIMIT_BYTES + 1), { status: 201 }),
    );
    expect(await testOpenEhrClient(fetch).createContribution(EHR_ID, BODY)).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", problem: "too_large" },
    });
  });

  it("reports a FerroEHR that does not answer as unreachable", async () => {
    const fetch = stack(() => {
      throw new TypeError("fetch failed");
    });
    expect(await testOpenEhrClient(fetch).createContribution(EHR_ID, BODY)).toMatchObject({
      ok: false,
      error: { kind: "unreachable", target: "ferroehr" },
    });
  });
});

describe("getContribution (EHR API, Get CONTRIBUTION)", () => {
  it("GETs the contribution by its uid and returns it", async () => {
    const fetch = stack(() => json(CONTRIBUTION));
    expect(await testOpenEhrClient(fetch).getContribution(EHR_ID, UID)).toEqual({
      ok: true,
      value: CONTRIBUTION,
    });
    const [call] = ferroCalls(fetch);
    expect(call?.method).toBe("GET");
    expect(call?.url).toBe(`${BASE}/ehr/${EHR_ID}/contribution/${UID}`);
  });

  it("returns null on 404: the EHR holds no such contribution", async () => {
    const fetch = stack(() => problem("not-found", 404));
    expect(await testOpenEhrClient(fetch).getContribution(EHR_ID, UID)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("reports a 500 as refused, never as a missing contribution", async () => {
    const fetch = stack(() => problem("internal", 500));
    expect(await testOpenEhrClient(fetch).getContribution(EHR_ID, UID)).toMatchObject({
      ok: false,
      error: { kind: "refused", status: 500 },
    });
  });

  it("reports a 204 as an unusable answer", async () => {
    const fetch = stack(() => new Response(null, { status: 204 }));
    expect(await testOpenEhrClient(fetch).getContribution(EHR_ID, UID)).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", status: 204 },
    });
  });
});

describe("getComposition (EHR API, Get COMPOSITION)", () => {
  const COMPOSITION = {
    _type: "COMPOSITION",
    archetype_details: { template_id: { value: "eduLIMS-lab.v1" } },
    content: [],
  };

  it("GETs the composition by its version id, encoded as one segment", async () => {
    const fetch = stack(() => json(COMPOSITION));
    expect(await testOpenEhrClient(fetch).getComposition(EHR_ID, VERSION)).toEqual({
      ok: true,
      value: COMPOSITION,
    });
    expect(ferroCalls(fetch)[0]?.url).toBe(
      `${BASE}/ehr/${EHR_ID}/composition/${encodeURIComponent(VERSION)}`,
    );
  });

  it("returns null on 404", async () => {
    const fetch = stack(() => problem("not-found", 404));
    expect(await testOpenEhrClient(fetch).getComposition(EHR_ID, VERSION)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("reports a document that is no COMPOSITION as an unusable answer", async () => {
    const fetch = stack(() => json({ _type: "EHR_STATUS" }));
    expect(await testOpenEhrClient(fetch).getComposition(EHR_ID, VERSION)).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", problem: "unexpected_shape" },
    });
  });

  it("reports a 204 (a deleted composition) as an unusable answer", async () => {
    const fetch = stack(() => new Response(null, { status: 204 }));
    expect(await testOpenEhrClient(fetch).getComposition(EHR_ID, VERSION)).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", status: 204 },
    });
  });
});
