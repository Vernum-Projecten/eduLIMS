// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The health check of FerroEHR and FerroBRIDGE (B3, #35). The targets come from the validated
// configuration only; no request can name or change one (SSRF, ASVS V1.3.6). FerroEHR is checked
// through the openEHR client (`options()`), FerroBRIDGE with `GET /health/readiness` from
// FERROBRIDGE_BASE_URL. A redirect is not followed, so a target cannot send the check on.
import "@tanstack/react-start/server-only";
import type { CheckErrorClass, CheckState, Integration } from "../../lib/integrations.ts";
import type { Env } from "../env.ts";
import type { OpenEhrClient, OpenEhrError } from "../openehr/index.ts";
import { getOpenEhrClient } from "../openehr/index.ts";
import { readCapped } from "../read-capped.ts";

/**
 * One check: FerroEHR through the openEHR client's `options()`, or a method on a FerroBRIDGE
 * URL from the configuration.
 */
export type ProbeTarget =
  | { integration: "ferroehr"; via: "openehr_client" }
  | { integration: "ferrobridge"; via: "http"; method: "GET"; url: URL };

/** The outcome of one check, without anything from the response but its timing and class. */
export interface CheckResult {
  integration: Integration;
  state: CheckState;
  checkedAt: Date;
  /** Milliseconds until the response arrived; `null` when none did. */
  responseTimeMs: number | null;
  errorClass: CheckErrorClass | null;
}

/** The `fetch` the check uses; a test passes a stub. */
export type ProbeFetch = (url: URL, init: RequestInit) => Promise<Response>;

/** What a check runs with: the openEHR client, the HTTP client, the clock and the timer. */
export interface ProbeDeps {
  openEhr: Pick<OpenEhrClient, "options">;
  fetch: ProbeFetch;
  now: () => Date;
  /** A monotonic clock in milliseconds (`performance.now`). */
  elapsed: () => number;
}

// NOTE: no requirement governs this: our own design. Five seconds keeps a whole check well under
// the 60 s schedule, so a hanging service shows as a timeout on the next screen refresh.
export const CHECK_TIMEOUT_MS = 5_000;

// NOTE: no requirement governs this: our own design. The check reads only whether the answer is
// a JSON object; a larger body than this is not a health answer.
export const CHECK_BODY_LIMIT_BYTES = 64 * 1024;

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Returns the two checks, built from configuration only.
 *
 * FerroEHR: the openEHR client's `options()`, the System API's "Options and Conformance"
 * operation of ITS-REST 1.1.0, which proves the service and its REST layer answer without
 * reading any EHR. FerroBRIDGE: `GET /health/readiness` beside its base URL.
 */
export function probeTargets(env: Pick<Env, "FERROBRIDGE_BASE_URL">): readonly ProbeTarget[] {
  return [
    { integration: "ferroehr", via: "openehr_client" },
    {
      integration: "ferrobridge",
      via: "http",
      method: "GET",
      url: new URL("health/readiness", withTrailingSlash(env.FERROBRIDGE_BASE_URL)),
    },
  ];
}

/** Returns whether `text` is a JSON object, the shape both health answers have. */
function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    // NOTE: a body that does not parse is a finding of the check, reported as its class.
    return false;
  }
}

/** Returns the class of a failed request: a timeout, or no connection at all. */
export function requestErrorClass(error: unknown): CheckErrorClass {
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "timeout";
  }
  return "unreachable";
}

/** Returns the class of an answer that is not a success. */
function statusErrorClass(status: number): CheckErrorClass {
  if (status === 401 || status === 403) return "auth_refused";
  if (status >= 500) return "http_server_error";
  if (status >= 400) return "http_client_error";
  return "unexpected_response";
}

/** Returns the check class of a failed openEHR client call. */
export function openEhrErrorClass(error: OpenEhrError): CheckErrorClass {
  switch (error.kind) {
    case "unreachable":
    case "timeout":
      return error.kind;
    case "auth_refused":
      return "auth_refused";
    case "refused":
      return statusErrorClass(error.status);
    case "invalid_response":
      return "unexpected_response";
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/** Checks one integration and returns its result; it never throws for a failing service. */
export async function probe(target: ProbeTarget, deps: ProbeDeps): Promise<CheckResult> {
  const started = deps.elapsed();
  const result = (
    state: CheckState,
    errorClass: CheckErrorClass | null,
    responseTimeMs: number | null,
  ): CheckResult => ({
    integration: target.integration,
    state,
    checkedAt: deps.now(),
    responseTimeMs,
    errorClass,
  });
  if (target.via === "openehr_client") {
    const answer = await deps.openEhr.options({ timeoutMs: CHECK_TIMEOUT_MS });
    const responseTimeMs = Math.max(0, Math.round(deps.elapsed() - started));
    if (answer.ok) return result("available", null, responseTimeMs);
    const errorClass = openEhrErrorClass(answer.error);
    if (errorClass === "timeout" || errorClass === "unreachable") {
      return result("unavailable", errorClass, null);
    }
    // NOTE: owner decision on #35: a 401 or 403 shows as refused, not as unavailable.
    const state = errorClass === "auth_refused" ? "refused" : "unavailable";
    return result(state, errorClass, responseTimeMs);
  }
  let response: Response;
  try {
    response = await deps.fetch(target.url, {
      method: target.method,
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch (error) {
    return result("unavailable", requestErrorClass(error), null);
  }
  const responseTimeMs = Math.max(0, Math.round(deps.elapsed() - started));
  if (response.status < 200 || response.status > 299) {
    await response.body?.cancel();
    const errorClass = statusErrorClass(response.status);
    // NOTE: owner decision on #35: a 401 or 403 means the service is reachable and refuses
    // eduLIMS's credentials, so it shows as refused, not as unavailable.
    const state = errorClass === "auth_refused" ? "refused" : "unavailable";
    return result(state, errorClass, responseTimeMs);
  }
  let body: string | undefined;
  try {
    body = await readCapped(response, CHECK_BODY_LIMIT_BYTES);
  } catch (error) {
    return result("unavailable", requestErrorClass(error), responseTimeMs);
  }
  if (body === undefined || !isJsonObject(body)) {
    return result("unavailable", "unexpected_response", responseTimeMs);
  }
  return result("available", null, responseTimeMs);
}

/** Checks every integration at once. */
export function probeAll(targets: readonly ProbeTarget[], deps: ProbeDeps): Promise<CheckResult[]> {
  return Promise.all(targets.map((target) => probe(target, deps)));
}

/**
 * Returns the real dependencies: the server's openEHR client, the global `fetch`, the wall
 * clock and the monotonic clock.
 */
export function defaultProbeDeps(): ProbeDeps {
  return {
    openEhr: getOpenEhrClient(),
    fetch: (url, init) => fetch(url, init),
    now: () => new Date(),
    elapsed: () => performance.now(),
  };
}
