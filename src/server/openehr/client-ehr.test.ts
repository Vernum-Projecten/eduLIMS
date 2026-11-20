// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The EHR operations of the openEHR client against FerroEHR and the token endpoint stubbed at the
// HTTP layer (testing.md): ITS-REST 1.1.0, EHR API, "Get EHR by subject id" and "Create EHR".
// Requirement: S11, Q-PRIV-1, Q-TRACE-1 (#147).
import { describe, expect, it, vi } from "vitest";
import { EHR_BODY_LIMIT_BYTES } from "./client.ts";
import { EHR_SUBJECT_NAMESPACE, ehrStatusFor } from "./ehr.ts";
import { TEST_OPENEHR_CONFIG, testOpenEhrClient } from "./test-client.ts";
import type { HttpFetch } from "./token.ts";

const BASE = TEST_OPENEHR_CONFIG.baseUrl.href;
const PROBLEMS = "https://ferroehr.eu/docs/latest/using-the-api/problems.html";
const PATIENT_ID = "0190f1c2-0000-7000-8000-000000000001";
const EHR_ID = "01a1f79f-e2d0-77ea-8eac-fe74ff33c1a2";
const SUBJECT = { id: PATIENT_ID, namespace: EHR_SUBJECT_NAMESPACE };

/** An EHR summary as FerroEHR 5.7.0 answers it (ITS-REST 1.1.0, `schemas/ehr/EHR.yaml`). */
const EHR = {
  _type: "EHR",
  system_id: { _type: "HIER_OBJECT_ID", value: "ferroehr.local" },
  ehr_id: { _type: "HIER_OBJECT_ID", value: EHR_ID },
  ehr_status: {
    _type: "OBJECT_REF",
    namespace: "local",
    type: "VERSIONED_EHR_STATUS",
    id: { _type: "HIER_OBJECT_ID", value: "01a1f79f-e2e6-713c-878c-1f1b2f8278c6" },
  },
  time_created: { _type: "DV_DATE_TIME", value: "2026-11-20T06:23:33.079198Z" },
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

/** The FerroEHR requests of a stub: method, URL and headers, the token request left out. */
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

describe("getEhrBySubject (EHR API, Get EHR by subject id)", () => {
  it("sends GET /ehr with subject_id and subject_namespace and returns the EHR", async () => {
    const fetch = stack(() => json(EHR));
    const result = await testOpenEhrClient(fetch).getEhrBySubject(SUBJECT);
    expect(result).toEqual({ ok: true, value: EHR });
    const [call] = ferroCalls(fetch);
    expect(call?.method).toBe("GET");
    expect(call?.url).toBe(
      `${BASE}/ehr?subject_id=${PATIENT_ID}&subject_namespace=${EHR_SUBJECT_NAMESPACE}`,
    );
    expect(call?.headers.get("Authorization")).toBe("Bearer t1");
    expect(call?.headers.get("Accept")).toBe("application/json");
    expect(call?.body).toBeUndefined();
  });

  it("encodes the subject as query parameters, never as path or raw text", async () => {
    const fetch = stack(() => json(EHR));
    await testOpenEhrClient(fetch).getEhrBySubject({ id: "a&b=c d", namespace: "n/s?x" });
    const url = new URL(ferroCalls(fetch)[0]?.url ?? "");
    expect(url.pathname.endsWith("/ehr")).toBe(true);
    expect(url.searchParams.get("subject_id")).toBe("a&b=c d");
    expect(url.searchParams.get("subject_namespace")).toBe("n/s?x");
  });

  it("returns null on 404: no EHR names the subject", async () => {
    const fetch = stack(() => json({ title: "Not Found", status: 404 }, 404));
    expect(await testOpenEhrClient(fetch).getEhrBySubject(SUBJECT)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("reports a 403 without the scope as refused authentication, never as a missing EHR", async () => {
    const fetch = stack(
      () =>
        new Response("{}", {
          status: 403,
          headers: { "WWW-Authenticate": 'Bearer realm="ferroehr", error="insufficient_scope"' },
        }),
    );
    expect(await testOpenEhrClient(fetch).getEhrBySubject(SUBJECT)).toEqual({
      ok: false,
      error: {
        kind: "auth_refused",
        target: "ferroehr",
        status: 403,
        reason: "insufficient_scope",
      },
    });
  });

  it("reports an EHR without a UUID ehr_id as an unusable answer", async () => {
    const fetch = stack(() => json({ ...EHR, ehr_id: { value: "not-a-uuid" } }));
    expect(await testOpenEhrClient(fetch).getEhrBySubject(SUBJECT)).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", status: 200, problem: "unexpected_shape" },
    });
  });

  it("reports a body that is not JSON as an unusable answer", async () => {
    const fetch = stack(() => new Response("<html/>", { status: 200 }));
    expect(await testOpenEhrClient(fetch).getEhrBySubject(SUBJECT)).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", problem: "not_json" },
    });
  });

  it("reports an answer over the EHR body limit as too large", async () => {
    const fetch = stack(() => new Response("x".repeat(EHR_BODY_LIMIT_BYTES + 1), { status: 200 }));
    expect(await testOpenEhrClient(fetch).getEhrBySubject(SUBJECT)).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", problem: "too_large" },
    });
  });

  it("reports an unreachable FerroEHR as unreachable", async () => {
    const fetch = stack(() => {
      throw new TypeError("fetch failed");
    });
    expect(await testOpenEhrClient(fetch).getEhrBySubject(SUBJECT)).toMatchObject({
      ok: false,
      error: { kind: "unreachable", target: "ferroehr" },
    });
  });
});

describe("createEhr (EHR API, Create EHR)", () => {
  it("sends POST /ehr with the EHR_STATUS as JSON and return=representation", async () => {
    const fetch = stack(() => json(EHR, 201));
    const status = ehrStatusFor(SUBJECT);
    const result = await testOpenEhrClient(fetch).createEhr(status);
    expect(result).toEqual({ ok: true, value: { outcome: "created", ehr: EHR } });
    const [call] = ferroCalls(fetch);
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(`${BASE}/ehr`);
    expect(call?.headers.get("Content-Type")).toBe("application/json");
    expect(call?.headers.get("Prefer")).toBe("return=representation");
    expect(call?.headers.get("Accept")).toBe("application/json");
    expect(JSON.parse(String(call?.body))).toEqual(status);
  });

  it("returns the outcome conflict on 409: an EHR names the subject already", async () => {
    const fetch = stack(() => problem("conflict", 409));
    expect(await testOpenEhrClient(fetch).createEhr(ehrStatusFor(SUBJECT))).toEqual({
      ok: true,
      value: { outcome: "conflict" },
    });
  });

  it("reports a 422 as refused with its openEHR code", async () => {
    const fetch = stack(() => problem("content-invalid", 422));
    expect(await testOpenEhrClient(fetch).createEhr(ehrStatusFor(SUBJECT))).toEqual({
      ok: false,
      error: { kind: "refused", target: "ferroehr", status: 422, code: "content-invalid" },
    });
  });

  it("reports a success other than 201 as an unusable answer", async () => {
    const fetch = stack(() => json(EHR, 200));
    expect(await testOpenEhrClient(fetch).createEhr(ehrStatusFor(SUBJECT))).toEqual({
      ok: false,
      error: {
        kind: "invalid_response",
        target: "ferroehr",
        status: 200,
        problem: "unexpected_shape",
      },
    });
  });

  it("reports a 201 without the EHR as an unusable answer", async () => {
    const fetch = stack(() => new Response("", { status: 201 }));
    expect(await testOpenEhrClient(fetch).createEhr(ehrStatusFor(SUBJECT))).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", status: 201, problem: "not_json" },
    });
  });

  it("puts no name, lab or user into the request: the patient id alone (Q-PRIV-1)", async () => {
    const fetch = stack(() => json(EHR, 201));
    const client = testOpenEhrClient(fetch);
    await client.getEhrBySubject(SUBJECT);
    await client.createEhr(ehrStatusFor(SUBJECT));
    const sent = JSON.stringify(
      fetch.mock.calls.map(([url, init]) => [url.href, init.body, [...new Headers(init.headers)]]),
    );
    for (const absent of [
      "@example.test",
      'name":"Ada',
      "lab",
      "student",
      "teacher",
      "committer",
    ]) {
      expect(sent).not.toContain(absent);
    }
    expect(sent).toContain(PATIENT_ID);
  });
});
