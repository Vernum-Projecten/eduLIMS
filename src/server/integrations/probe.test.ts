// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The health check of FerroEHR and FerroBRIDGE (B3), stubbed at the HTTP layer (testing.md).
import { describe, expect, it, vi } from "vitest";
import { testOpenEhrClient } from "../openehr/test-client.ts";
import {
  CHECK_BODY_LIMIT_BYTES,
  CHECK_TIMEOUT_MS,
  openEhrErrorClass,
  type ProbeDeps,
  type ProbeFetch,
  probe,
  probeTargets,
  requestErrorClass,
} from "./probe.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
const CONFIG = {
  FERROEHR_BASE_URL: "http://ferroehr.test:8080/ferroehr/rest/openehr/v1",
  FERROBRIDGE_BASE_URL: "http://ferrobridge.test:8080",
};
const [FERROEHR, FERROBRIDGE] = probeTargets(CONFIG);

function deps(fetch: ProbeFetch, elapsed = [100, 142]): ProbeDeps {
  const times = [...elapsed];
  const openEhr = testOpenEhrClient(fetch, { baseUrl: CONFIG.FERROEHR_BASE_URL });
  return { openEhr, fetch, now: () => NOW, elapsed: () => times.shift() ?? 0 };
}

function answer(body: string, status = 200): ProbeFetch {
  return () => Promise.resolve(new Response(body, { status }));
}

function target() {
  if (!FERROEHR || !FERROBRIDGE) throw new Error("two targets expected");
  return { ferroehr: FERROEHR, ferrobridge: FERROBRIDGE };
}

describe("probeTargets (B3, ASVS V1.3.6)", () => {
  it("builds both targets from the configuration only, FerroEHR through the client (#94)", () => {
    expect(
      probeTargets(CONFIG).map((t) =>
        t.via === "http" ? [t.integration, t.method, t.url.href] : [t.integration, t.via],
      ),
    ).toEqual([
      ["ferroehr", "openehr_client"],
      ["ferrobridge", "GET", "http://ferrobridge.test:8080/health/readiness"],
    ]);
  });

  it("keeps a FerroBRIDGE base path, with or without a trailing slash", () => {
    for (const base of ["http://bridge.test/edu", "http://bridge.test/edu/"]) {
      const bridge = probeTargets({ ...CONFIG, FERROBRIDGE_BASE_URL: base }).at(1);
      expect(bridge?.via === "http" ? bridge.url.href : undefined).toBe(
        "http://bridge.test/edu/health/readiness",
      );
    }
  });
});

describe("probe (B3)", () => {
  it("reports a FerroBRIDGE JSON answer as available with its response time", async () => {
    const fetch = vi.fn<ProbeFetch>(answer('{"state":"up"}'));
    const result = await probe(target().ferrobridge, deps(fetch));
    expect(result).toEqual({
      integration: "ferrobridge",
      state: "available",
      checkedAt: NOW,
      responseTimeMs: 42,
      errorClass: null,
      ferroehr: null,
      ferrobridge: { phase: null, failingIndicators: [] },
    });
  });

  it("sends the openEHR System API OPTIONS without following a redirect, with a timeout", async () => {
    const fetch = vi.fn<ProbeFetch>(answer("{}"));
    await probe(target().ferroehr, deps(fetch));
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url?.href).toBe(CONFIG.FERROEHR_BASE_URL);
    expect(init).toMatchObject({ method: "OPTIONS", redirect: "manual" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(CHECK_TIMEOUT_MS).toBe(5_000);
  });

  it("sends the FerroEHR OPTIONS without a credential (#94); the token is for the sign-in step (#227)", async () => {
    const fetch = vi.fn<ProbeFetch>(answer("{}"));
    await probe(target().ferroehr, deps(fetch));
    const [optionsUrl, optionsInit] = fetch.mock.calls[0] ?? [];
    expect(optionsUrl?.href).toBe(CONFIG.FERROEHR_BASE_URL);
    expect(new Headers(optionsInit?.headers).has("Authorization")).toBe(false);
    // The second call is the token request of the sign-in step, never FerroEHR with a credential.
    expect(fetch.mock.calls.slice(1).map(([url]) => url.hostname)).toEqual(["idp.test"]);
  });

  it("does not sign in when FerroEHR is not reachable (#227)", async () => {
    const fetch = vi.fn<ProbeFetch>(() => Promise.reject(new TypeError("fetch failed")));
    await probe(target().ferroehr, deps(fetch));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [503, "http_server_error"],
    [404, "http_client_error"],
    [302, "unexpected_response"],
  ] as const)("reports a FerroEHR HTTP %i as unavailable (%s)", async (status, errorClass) => {
    const result = await probe(target().ferroehr, deps(answer("{}", status)));
    expect(result).toMatchObject({ state: "unavailable", errorClass, responseTimeMs: 42 });
  });

  it("reports a FerroEHR 200 that is not a JSON object, or too large, as unexpected", async () => {
    const big = `{"x":"${"a".repeat(CHECK_BODY_LIMIT_BYTES)}"}`;
    for (const body of ["<html>proxy</html>", "[]", "null", "", big]) {
      const result = await probe(target().ferroehr, deps(answer(body)));
      expect(result).toMatchObject({ state: "unavailable", errorClass: "unexpected_response" });
    }
  });

  it.each([
    [500, "http_server_error"],
    [503, "http_server_error"],
    [404, "http_client_error"],
    [302, "unexpected_response"],
  ] as const)("reports HTTP %i as unavailable (%s)", async (status, errorClass) => {
    const result = await probe(target().ferrobridge, deps(answer("{}", status)));
    expect(result).toMatchObject({ state: "unavailable", errorClass, responseTimeMs: 42 });
  });

  it.each([401, 403])(
    "reports HTTP %i as refused (authentication), not unavailable (owner decision on #35)",
    async (status) => {
      const result = await probe(target().ferroehr, deps(answer("{}", status)));
      expect(result).toMatchObject({
        state: "refused",
        errorClass: "auth_refused",
        responseTimeMs: 42,
      });
    },
  );

  it("reports a 200 that is not a JSON object as an unexpected response", async () => {
    for (const body of ["<html>proxy</html>", "[]", "null", ""]) {
      const result = await probe(target().ferrobridge, deps(answer(body)));
      expect(result).toMatchObject({ state: "unavailable", errorClass: "unexpected_response" });
    }
  });

  it("refuses an answer larger than the body limit", async () => {
    const big = `{"x":"${"a".repeat(CHECK_BODY_LIMIT_BYTES)}"}`;
    const result = await probe(target().ferrobridge, deps(answer(big)));
    expect(result).toMatchObject({ state: "unavailable", errorClass: "unexpected_response" });
  });

  it("reports a refused connection as unreachable, with no response time", async () => {
    const fetch: ProbeFetch = () => Promise.reject(new TypeError("fetch failed"));
    const result = await probe(target().ferroehr, deps(fetch));
    expect(result).toMatchObject({
      state: "unavailable",
      errorClass: "unreachable",
      responseTimeMs: null,
    });
  });

  it("reports a timeout as such", async () => {
    const fetch: ProbeFetch = () =>
      Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    const result = await probe(target().ferroehr, deps(fetch));
    expect(result).toMatchObject({ state: "unavailable", errorClass: "timeout" });
  });

  it("classifies every openEHR client error", () => {
    expect(openEhrErrorClass({ kind: "timeout", target: "ferroehr", cause: null })).toBe("timeout");
    expect(openEhrErrorClass({ kind: "unreachable", target: "ferroehr", cause: null })).toBe(
      "unreachable",
    );
    expect(
      openEhrErrorClass({ kind: "auth_refused", target: "ferroehr", status: 403, reason: null }),
    ).toBe("auth_refused");
    expect(
      openEhrErrorClass({ kind: "refused", target: "ferroehr", status: 500, code: null }),
    ).toBe("http_server_error");
    expect(
      openEhrErrorClass({
        kind: "invalid_response",
        target: "ferroehr",
        status: 200,
        problem: "not_json",
      }),
    ).toBe("unexpected_response");
  });

  it("classifies request errors", () => {
    expect(requestErrorClass(new DOMException("x", "AbortError"))).toBe("timeout");
    expect(requestErrorClass(new Error("x"))).toBe("unreachable");
    expect(requestErrorClass("x")).toBe("unreachable");
  });
});
