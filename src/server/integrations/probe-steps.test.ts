// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The steps of the FerroEHR check and FerroBRIDGE's readiness detail (B3, #227), stubbed at the
// HTTP layer (testing.md): every state and every refusal, and nothing secret in a result.
import { describe, expect, it, vi } from "vitest";
import { EDULIMS_TEMPLATE_ID } from "../../lib/integrations.ts";
import { TEST_OPENEHR_CONFIG, testOpenEhrClient } from "../openehr/test-client.ts";
import {
  failingIndicators,
  MAX_FAILING_INDICATORS,
  type ProbeDeps,
  type ProbeFetch,
  probe,
  probeTargets,
} from "./probe.ts";

const NOW = new Date("2026-11-12T12:00:00Z");
const BASE = "http://ferroehr.test:8080/ferroehr/rest/openehr/v1";
const TEMPLATES = `${BASE}/definition/template/adl1.4`;
const TOKEN = TEST_OPENEHR_CONFIG.tokenUrl.href;
const ACCESS_TOKEN = "test-access-token-not-to-leak";
const [FERROEHR, FERROBRIDGE] = probeTargets({ FERROBRIDGE_BASE_URL: "http://ferrobridge.test" });

type Handler = () => Promise<Response>;

const json = (body: unknown, status = 200, headers: HeadersInit = {}): Handler => {
  return () => Promise.resolve(Response.json(body, { status, headers }));
};
const down: Handler = () => Promise.reject(new TypeError("fetch failed"));

const MANIFEST = json({
  solution: "FerroEHR",
  solution_version: "5.7.0",
  restapi_specs_version: "1.1.0",
});
const GRANT = json({ access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 300 });
const template = (id: string) => ({
  template_id: id,
  concept: "Lab result",
  archetype_id: "openEHR-EHR-COMPOSITION.report-result.v1",
  created_timestamp: "2026-11-01T00:00:00Z",
});
const WITH_TEMPLATE = json([template("other.v1"), template(EDULIMS_TEMPLATE_ID)]);

/** A fetch that answers the manifest, the token endpoint, the template list and FerroBRIDGE. */
function services(
  handlers: { options?: Handler; token?: Handler; templates?: Handler; bridge?: Handler } = {},
) {
  return vi.fn<ProbeFetch>((url, init) => {
    if (url.href === TOKEN) return (handlers.token ?? GRANT)();
    if (url.href === TEMPLATES) return (handlers.templates ?? WITH_TEMPLATE)();
    if (url.href === BASE && init.method === "OPTIONS") return (handlers.options ?? MANIFEST)();
    if (url.hostname === "ferrobridge.test") return (handlers.bridge ?? json({ state: "up" }))();
    return Promise.reject(new Error(`unexpected ${url.href}`));
  });
}

function deps(fetch: ProbeFetch): ProbeDeps {
  const times = [100, 142];
  return {
    openEhr: testOpenEhrClient(fetch, { baseUrl: BASE }),
    fetch,
    now: () => NOW,
    elapsed: () => times.shift() ?? 0,
  };
}

function targets() {
  if (!FERROEHR || !FERROBRIDGE) throw new Error("two targets expected");
  return { ferroehr: FERROEHR, ferrobridge: FERROBRIDGE };
}

const checkFerroEhr = (fetch: ProbeFetch) => probe(targets().ferroehr, deps(fetch));
const checkBridge = (fetch: ProbeFetch) => probe(targets().ferrobridge, deps(fetch));

describe("the FerroEHR steps (B3, #227)", () => {
  it("is available when it is reachable, signed in and holds the template, with its versions", async () => {
    const result = await checkFerroEhr(services());
    expect(result).toEqual({
      integration: "ferroehr",
      state: "available",
      checkedAt: NOW,
      responseTimeMs: 42,
      errorClass: null,
      ferrobridge: null,
      ferroehr: {
        steps: { reachable: "passed", signed_in: "passed", template_loaded: "passed" },
        serverVersion: "5.7.0",
        specVersion: "1.1.0",
        signInTarget: null,
        authReason: null,
      },
    });
  });

  it("reads the template list with the token and the check timeout", async () => {
    const fetch = services();
    await checkFerroEhr(fetch);
    const list = fetch.mock.calls.find(([url]) => url.href === TEMPLATES);
    expect(new Headers(list?.[1].headers).get("Authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(list?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(list?.[1].redirect).toBe("manual");
  });

  it("keeps a version that is not a plain version out of the result", async () => {
    const options = json({ solution_version: "5.7 <script>", restapi_specs_version: "" });
    const result = await checkFerroEhr(services({ options }));
    expect(result.ferroehr).toMatchObject({ serverVersion: null, specVersion: null });
  });

  it("shows a missing eduLIMS template as not ready, not as an error of eduLIMS", async () => {
    const result = await checkFerroEhr(services({ templates: json([template("other.v1")]) }));
    expect(result).toMatchObject({ state: "not_ready", errorClass: "template_missing" });
    expect(result.ferroehr?.steps).toEqual({
      reachable: "passed",
      signed_in: "passed",
      template_loaded: "missing",
    });
  });

  it("treats an empty template list as a missing template", async () => {
    const result = await checkFerroEhr(services({ templates: json([]) }));
    expect(result.ferroehr?.steps.template_loaded).toBe("missing");
  });

  it("shows a refused token as Refused (authentication) with its reason code", async () => {
    const token = json({ error: "invalid_client", error_description: "secret mismatch" }, 401);
    const result = await checkFerroEhr(services({ token }));
    expect(result).toMatchObject({ state: "refused", errorClass: "auth_refused" });
    expect(result.ferroehr).toMatchObject({
      steps: { reachable: "passed", signed_in: "refused", template_loaded: "skipped" },
      signInTarget: "token_endpoint",
      authReason: "invalid_client",
      serverVersion: "5.7.0",
    });
    expect(JSON.stringify(result)).not.toContain("secret mismatch");
  });

  it("shows a token FerroEHR refuses with the challenge's reason code", async () => {
    const templates = json({}, 403, {
      "WWW-Authenticate": 'Bearer error="insufficient_scope"',
    });
    const result = await checkFerroEhr(services({ templates }));
    expect(result).toMatchObject({ state: "refused", errorClass: "auth_refused" });
    expect(result.ferroehr).toMatchObject({
      steps: { signed_in: "refused", template_loaded: "skipped" },
      signInTarget: "ferroehr",
      authReason: "insufficient_scope",
    });
  });

  it("drops a reason code that is not a plain code", async () => {
    const token = json({ error: "bad code!" }, 400);
    const result = await checkFerroEhr(services({ token }));
    expect(result.ferroehr?.authReason).toBeNull();
    expect(result.state).toBe("refused");
  });

  it("shows an unreachable token endpoint as unavailable at the sign-in step", async () => {
    const result = await checkFerroEhr(services({ token: down }));
    expect(result).toMatchObject({ state: "unavailable", errorClass: "unreachable" });
    expect(result.ferroehr).toMatchObject({
      steps: { reachable: "passed", signed_in: "failed", template_loaded: "skipped" },
      signInTarget: "token_endpoint",
      authReason: null,
    });
  });

  it("shows a failing template read as unavailable at the sign-in step", async () => {
    const result = await checkFerroEhr(services({ templates: json({}, 500) }));
    expect(result).toMatchObject({ state: "unavailable", errorClass: "http_server_error" });
    expect(result.ferroehr?.steps.signed_in).toBe("failed");
    expect(result.ferroehr?.signInTarget).toBe("ferroehr");
  });

  it("shows a template list that is not a list as an unexpected answer", async () => {
    const result = await checkFerroEhr(services({ templates: json({ templates: [] }) }));
    expect(result).toMatchObject({ state: "unavailable", errorClass: "unexpected_response" });
  });

  it("skips signing in and the template when FerroEHR is not reachable", async () => {
    const fetch = services({ options: down });
    const result = await checkFerroEhr(fetch);
    expect(result).toMatchObject({
      state: "unavailable",
      errorClass: "unreachable",
      responseTimeMs: null,
    });
    expect(result.ferroehr?.steps).toEqual({
      reachable: "failed",
      signed_in: "skipped",
      template_loaded: "skipped",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows a refused manifest as refused at the reachable step", async () => {
    const result = await checkFerroEhr(services({ options: json({}, 401) }));
    expect(result.state).toBe("refused");
    expect(result.ferroehr?.steps.reachable).toBe("refused");
  });

  it("never puts the token, the client secret or a body into a result", async () => {
    for (const handlers of [{}, { templates: json([]) }, { token: json({ error: "x" }, 401) }]) {
      const text = JSON.stringify(await checkFerroEhr(services(handlers)));
      expect(text).not.toContain(ACCESS_TOKEN);
      expect(text).not.toContain(TEST_OPENEHR_CONFIG.clientSecret);
      expect(text).not.toContain("Lab result");
    }
  });
});

describe("the FerroBRIDGE readiness (B3, #227)", () => {
  const readiness = (body: unknown) => services({ bridge: json(body, 503) });

  it("names the indicator that is down when it is not ready", async () => {
    const result = await checkBridge(
      readiness({
        state: "down",
        phase: "serving",
        indicators: [
          { name: "cdr", state: "up" },
          { name: "terminology", state: "down" },
        ],
      }),
    );
    expect(result).toMatchObject({
      state: "not_ready",
      errorClass: "readiness_down",
      responseTimeMs: 42,
      ferroehr: null,
      ferrobridge: { phase: "serving", failingIndicators: ["terminology"] },
    });
  });

  it("names the phase while it boots, with no indicator down", async () => {
    const result = await checkBridge(
      readiness({ state: "down", phase: "booting", indicators: [] }),
    );
    expect(result.ferrobridge).toEqual({ phase: "booting", failingIndicators: [] });
  });

  it("drops an unknown phase", async () => {
    const result = await checkBridge(readiness({ state: "down", phase: "x y", indicators: [] }));
    expect(result.ferrobridge?.phase).toBeNull();
  });

  it("keeps a 503 that is not a readiness document an HTTP server error", async () => {
    const result = await checkBridge(services({ bridge: json({ message: "maintenance" }, 503) }));
    expect(result).toMatchObject({ state: "unavailable", errorClass: "http_server_error" });
  });

  it("lists only safe, unique indicator names, at most the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `ind-${i}`, state: "down" }));
    expect(
      failingIndicators([
        { name: "cdr", state: "down" },
        { name: "cdr", state: "degraded" },
        { name: "Bad Name", state: "down" },
        { name: "ok", state: "up" },
      ]),
    ).toEqual(["cdr"]);
    expect(failingIndicators(many)).toHaveLength(MAX_FAILING_INDICATORS);
  });
});
