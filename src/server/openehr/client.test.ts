// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The openEHR client against FerroEHR and the token endpoint stubbed at the HTTP layer
// (testing.md), for ITS-REST 1.1.0 (System and Definition APIs). Requirement: Q-COMP-1, B3.
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPTIONS_BODY_LIMIT_BYTES } from "./client.ts";
import { describeOpenEhrError, type OpenEhrError, openEhrErrorCode } from "./errors.ts";
import { TEST_OPENEHR_CONFIG, testOpenEhrClient } from "./test-client.ts";
import type { HttpFetch } from "./token.ts";

const BASE = TEST_OPENEHR_CONFIG.baseUrl.href;
const TEMPLATES = `${BASE}/definition/template/adl1.4`;
const PROBLEMS = "https://ferroehr.eu/docs/latest/using-the-api/problems.html";

afterEach(() => {
  vi.restoreAllMocks();
});

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** A stub with a token endpoint that hands out `t1`, `t2`, … and FerroEHR answering `ferroehr`. */
function stack(ferroehr: Handler) {
  let issued = 0;
  return vi.fn<HttpFetch>(async (url, init) => {
    if (url.href === TEST_OPENEHR_CONFIG.tokenUrl.href) {
      issued += 1;
      return json({ access_token: `t${issued}`, token_type: "Bearer", expires_in: 300 });
    }
    return ferroehr(url, init);
  });
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function problem(type: string, status: number, headers: Record<string, string> = {}): Response {
  return json({ type: `${PROBLEMS}#${type}`, title: "t", status, detail: "d" }, status, headers);
}

function calls(fetch: ReturnType<typeof stack>) {
  return fetch.mock.calls.map(([url, init]) => {
    const auth = new Headers(init.headers).get("Authorization");
    return `${init.method} ${url.href} ${auth ?? "-"}`;
  });
}

const MANIFEST = { solution: "FerroEHR", restapi_specs_version: "1.1.0", endpoints: ["/ehr"] };
const LIST = [
  { template_id: "zeta", concept: "Z", archetype_id: "a", created_timestamp: "2026-01-01" },
  {
    template_id: "eduLIMS-lab",
    concept: "Lab",
    archetype_id: "a",
    created_timestamp: "2026-01-01",
  },
];

describe("options (ITS-REST 1.1.0 System API)", () => {
  it("returns the conformance manifest from OPTIONS on the base path, unauthenticated", async () => {
    const fetch = stack(() => json(MANIFEST));
    expect(await testOpenEhrClient(fetch).options()).toEqual({ ok: true, value: MANIFEST });
    expect(calls(fetch)).toEqual([`OPTIONS ${BASE} -`]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("reports a 401 as refused authentication without fetching a token", async () => {
    const fetch = stack(() => problem("unauthenticated", 401));
    const result = await testOpenEhrClient(fetch).options();
    expect(result).toEqual({
      ok: false,
      error: { kind: "auth_refused", target: "ferroehr", status: 401, reason: "unauthenticated" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer larger than its body limit", async () => {
    const big = `{"x":"${"a".repeat(OPTIONS_BODY_LIMIT_BYTES)}"}`;
    const result = await testOpenEhrClient(stack(() => new Response(big))).options();
    expect(result).toMatchObject({ ok: false, error: { problem: "too_large", status: 200 } });
  });

  it("reports a timeout and an unreachable FerroEHR", async () => {
    const slow = stack(() => Promise.reject(new DOMException("late", "TimeoutError")));
    const down = stack(() => Promise.reject(new TypeError("fetch failed")));
    expect(await testOpenEhrClient(slow).options({ timeoutMs: 5 })).toMatchObject({
      ok: false,
      error: { kind: "timeout", target: "ferroehr" },
    });
    expect(await testOpenEhrClient(down).options()).toMatchObject({
      ok: false,
      error: { kind: "unreachable", target: "ferroehr" },
    });
  });

  it("times a hanging FerroEHR out after the configured timeout", async () => {
    const hang = stack(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const result = await testOpenEhrClient(hang, { timeoutMs: 20 }).options();
    expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });
});

describe("listTemplates (Definition API, List templates)", () => {
  it("sends the bearer token and returns the list ordered by template_id", async () => {
    const fetch = stack(() => json(LIST));
    const result = await testOpenEhrClient(fetch).listTemplates();
    expect(result.ok && result.value.map((t) => t.template_id)).toEqual(["eduLIMS-lab", "zeta"]);
    const [grant, get] = calls(fetch);
    expect(grant).toMatch(new RegExp(`^POST ${TEST_OPENEHR_CONFIG.tokenUrl.href} Basic `));
    expect(get).toBe(`GET ${TEMPLATES} Bearer t1`);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reuses the cached token for the next call", async () => {
    const fetch = stack(() => json(LIST));
    const client = testOpenEhrClient(fetch);
    await client.listTemplates();
    await client.listTemplates();
    expect(calls(fetch).filter((line) => line.startsWith("GET"))).toEqual([
      `GET ${TEMPLATES} Bearer t1`,
      `GET ${TEMPLATES} Bearer t1`,
    ]);
  });

  it("refetches the token once on a 401 and repeats the call", async () => {
    const fetch = stack((_url, init) =>
      new Headers(init.headers).get("Authorization") === "Bearer t1"
        ? problem("unauthenticated", 401, { "WWW-Authenticate": 'Bearer error="invalid_token"' })
        : json(LIST),
    );
    const result = await testOpenEhrClient(fetch).listTemplates();
    expect(result.ok).toBe(true);
    expect(calls(fetch).filter((line) => line.startsWith("GET"))).toEqual([
      `GET ${TEMPLATES} Bearer t1`,
      `GET ${TEMPLATES} Bearer t2`,
    ]);
  });

  it("reports a second 401 as refused authentication with the challenge's error", async () => {
    const fetch = stack(() =>
      problem("unauthenticated", 401, { "WWW-Authenticate": 'Bearer error="invalid_token"' }),
    );
    const result = await testOpenEhrClient(fetch).listTemplates();
    expect(result).toEqual({
      ok: false,
      error: { kind: "auth_refused", target: "ferroehr", status: 401, reason: "invalid_token" },
    });
    expect(calls(fetch).filter((line) => line.startsWith("GET"))).toHaveLength(2);
  });

  it("reports a 403 as refused authentication, insufficient_scope, without a retry", async () => {
    const fetch = stack(() =>
      problem("forbidden", 403, { "WWW-Authenticate": 'Bearer error="insufficient_scope"' }),
    );
    const result = await testOpenEhrClient(fetch).listTemplates();
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "auth_refused", status: 403, reason: "insufficient_scope" },
    });
    expect(calls(fetch).filter((line) => line.startsWith("GET"))).toHaveLength(1);
  });

  it("stops at a refused grant and never calls FerroEHR", async () => {
    const fetch = vi.fn<HttpFetch>(() => Promise.resolve(json({ error: "invalid_client" }, 401)));
    const result = await testOpenEhrClient(fetch).listTemplates();
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "auth_refused",
        target: "token_endpoint",
        status: 401,
        reason: "invalid_client",
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a 5xx as refused by FerroEHR with its status and code", async () => {
    const result = await testOpenEhrClient(
      stack(() => problem("unavailable", 503)),
    ).listTemplates();
    expect(result).toEqual({
      ok: false,
      error: { kind: "refused", target: "ferroehr", status: 503, code: "unavailable" },
    });
  });

  it("refuses a list that does not match the TemplateList schema", async () => {
    const result = await testOpenEhrClient(stack(() => json([{ concept: "x" }]))).listTemplates();
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "invalid_response", problem: "unexpected_shape" },
    });
  });
});

describe("getTemplate (Definition API, Get a template)", () => {
  it("asks for the OPT XML and returns it", async () => {
    const fetch = stack(() => new Response("<template/>", { status: 200 }));
    const result = await testOpenEhrClient(fetch).getTemplate("eduLIMS-lab", "opt");
    expect(result).toEqual({ ok: true, value: { format: "opt", xml: "<template/>" } });
    const [url, init] = fetch.mock.calls.at(-1) ?? [];
    expect(url?.href).toBe(`${TEMPLATES}/eduLIMS-lab`);
    expect(new Headers(init?.headers).get("Accept")).toBe("application/xml");
  });

  it("asks for the WebTemplate and validates its required members", async () => {
    const wt = {
      templateId: "eduLIMS-lab",
      version: "2.3",
      defaultLanguage: "en",
      languages: ["en"],
      tree: { id: "x" },
    };
    const fetch = stack(() => json(wt));
    const result = await testOpenEhrClient(fetch).getTemplate("eduLIMS-lab", "web_template");
    expect(result).toEqual({ ok: true, value: { format: "web_template", webTemplate: wt } });
    expect(new Headers(fetch.mock.calls.at(-1)?.[1].headers).get("Accept")).toBe(
      "application/openehr.wt+json",
    );
  });

  it("encodes the template id as one path segment", async () => {
    const fetch = stack(() => new Response("<template/>"));
    await testOpenEhrClient(fetch).getTemplate("Vital Signs/../x", "opt");
    expect(fetch.mock.calls.at(-1)?.[0].href).toBe(`${TEMPLATES}/Vital%20Signs%2F..%2Fx`);
  });

  it("reports an unknown template as refused with 404", async () => {
    const fetch = stack(() => json({ type: "about:blank", title: "Not Found", status: 404 }, 404));
    expect(await testOpenEhrClient(fetch).getTemplate("nope", "opt")).toEqual({
      ok: false,
      error: { kind: "refused", target: "ferroehr", status: 404, code: null },
    });
  });

  it("refuses an OPT answer that is not XML", async () => {
    const result = await testOpenEhrClient(stack(() => json({}))).getTemplate("x", "opt");
    expect(result).toMatchObject({ ok: false, error: { problem: "unexpected_shape" } });
  });

  it("throws on an empty template id", async () => {
    await expect(testOpenEhrClient(stack(() => json({}))).getTemplate(" ", "opt")).rejects.toThrow(
      RangeError,
    );
  });
});

describe("uploadTemplate (Definition API, Upload a template)", () => {
  it("posts the OPT as XML and returns the created template id", async () => {
    const fetch = stack(() => json({ template_id: "eduLIMS-lab" }, 201));
    const result = await testOpenEhrClient(fetch).uploadTemplate("<template/>");
    expect(result).toEqual({ ok: true, value: { outcome: "created", templateId: "eduLIMS-lab" } });
    const [url, init] = fetch.mock.calls.at(-1) ?? [];
    expect(url?.href).toBe(TEMPLATES);
    expect(init).toMatchObject({ method: "POST", body: "<template/>" });
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBe("application/xml");
    expect(headers.get("Prefer")).toBe("return=identifier");
  });

  it("maps a 409 to the typed exists outcome", async () => {
    const fetch = stack(() => problem("conflict", 409));
    expect(await testOpenEhrClient(fetch).uploadTemplate("<template/>")).toEqual({
      ok: true,
      value: { outcome: "exists" },
    });
  });

  it("reports an invalid template as refused with 400 and its code", async () => {
    const fetch = stack(() => problem("validation-failed", 400));
    expect(await testOpenEhrClient(fetch).uploadTemplate("<x/>")).toEqual({
      ok: false,
      error: { kind: "refused", target: "ferroehr", status: 400, code: "validation-failed" },
    });
  });
});

describe("privacy of failures (Q-COMP-1, auth-security.md)", () => {
  it("keeps the secret and the token out of every error and every log line", async () => {
    const spies = (["error", "warn", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const handlers: Handler[] = [
      () => problem("unauthenticated", 401, { "WWW-Authenticate": 'Bearer error="invalid_token"' }),
      () => problem("forbidden", 403),
      () => problem("unavailable", 503),
      () => json("not a list"),
      () => Promise.reject(new TypeError("fetch failed")),
    ];
    const errors: OpenEhrError[] = [];
    for (const handler of handlers) {
      const result = await testOpenEhrClient(stack(handler)).listTemplates();
      if (!result.ok) errors.push(result.error);
    }
    expect(errors).toHaveLength(handlers.length);
    const text = errors.map((error) => `${JSON.stringify(error)} ${describeOpenEhrError(error)}`);
    for (const line of text) {
      expect(line).not.toContain(TEST_OPENEHR_CONFIG.clientSecret);
      expect(line).not.toMatch(/\bt[12]\b/);
      expect(line).not.toContain("Bearer");
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("describes each kind of error on one line of ids and codes", () => {
    const errors: OpenEhrError[] = [
      { kind: "timeout", target: "ferroehr", cause: new DOMException("x", "TimeoutError") },
      { kind: "unreachable", target: "token_endpoint", cause: "x" },
      { kind: "auth_refused", target: "ferroehr", status: 403, reason: null },
      { kind: "refused", target: "ferroehr", status: 500, code: "x" },
      { kind: "invalid_response", target: "ferroehr", status: 200, problem: "not_json" },
    ];
    expect(errors.map(describeOpenEhrError)).toEqual([
      "openehr_timeout target=ferroehr cause=TimeoutError",
      "openehr_unreachable target=token_endpoint cause=string",
      "openehr_auth_refused target=ferroehr status=403 reason=none",
      "openehr_refused target=ferroehr status=500 code=x",
      "openehr_invalid_response target=ferroehr status=200 problem=not_json",
    ]);
  });
});

describe("openEhrErrorCode", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["<html/>", null],
    ["[]", null],
    [JSON.stringify({ type: `${PROBLEMS}#aql-invalid` }), "aql-invalid"],
    [JSON.stringify({ type: "about:blank" }), null],
    [JSON.stringify({ message: "m", code: 90000 }), "90000"],
    [JSON.stringify({ code: "E_1" }), "E_1"],
    [JSON.stringify({ code: 1.5 }), null],
  ])("reads %j as %j", (body, code) => {
    expect(openEhrErrorCode(body)).toBe(code);
  });
});
