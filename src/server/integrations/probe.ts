// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The health check of FerroEHR and FerroBRIDGE (B3, #35). The targets come from the validated
// configuration only (FERROEHR_BASE_URL, FERROBRIDGE_BASE_URL); no request can name or change
// one (SSRF, ASVS V1.3.6). A redirect is not followed, so a target cannot send the check on.
import "@tanstack/react-start/server-only";
import type { CheckErrorClass, CheckState, Integration } from "../../lib/integrations.ts";
import type { Env } from "../env.ts";

/** One request the check sends: a method on a URL from the configuration. */
export interface ProbeTarget {
  integration: Integration;
  method: "OPTIONS" | "GET";
  url: URL;
}

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

/** What a check runs with: the HTTP client, the clock and the timer. */
export interface ProbeDeps {
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
 * Returns the two requests of a check, built from configuration only.
 *
 * FerroEHR: `OPTIONS` on the openEHR REST base URL, the System API's "Options and Conformance"
 * operation of ITS-REST 1.1.0 (`system.html`), which proves the service and its REST layer
 * answer without reading any EHR. FerroBRIDGE: `GET /health/readiness` beside its base URL.
 */
export function probeTargets(
  env: Pick<Env, "FERROEHR_BASE_URL" | "FERROBRIDGE_BASE_URL">,
): readonly ProbeTarget[] {
  // TODO(#94): send the FerroEHR OPTIONS through the openEHR client in src/server/openehr/.
  return [
    { integration: "ferroehr", method: "OPTIONS", url: new URL(env.FERROEHR_BASE_URL) },
    {
      integration: "ferrobridge",
      method: "GET",
      url: new URL("health/readiness", withTrailingSlash(env.FERROBRIDGE_BASE_URL)),
    },
  ];
}

/** Reads at most {@link CHECK_BODY_LIMIT_BYTES} of a body; `undefined` when it is larger. */
async function readCapped(response: Response): Promise<string | undefined> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CHECK_BODY_LIMIT_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
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
    body = await readCapped(response);
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

/** The real dependencies: the global `fetch`, the wall clock and the monotonic clock. */
export const DEFAULT_PROBE_DEPS: ProbeDeps = {
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  elapsed: () => performance.now(),
};
