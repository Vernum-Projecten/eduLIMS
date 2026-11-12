// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The health check of FerroEHR and FerroBRIDGE (B3, #35, #227). The targets come from the
// validated configuration only; no request can name or change one (SSRF, ASVS V1.3.6). FerroEHR
// is checked in three steps through the openEHR client, FerroBRIDGE with `GET /health/readiness`
// from FERROBRIDGE_BASE_URL. A redirect is not followed, so a target cannot send the check on.
import "@tanstack/react-start/server-only";
import { z } from "zod";
import {
  AUTH_REASON_PATTERN,
  type CheckErrorClass,
  type CheckState,
  EDULIMS_TEMPLATE_ID,
  type FerroBridgeDetail,
  type FerroEhrDetail,
  type FerroEhrSteps,
  INDICATOR_PATTERN,
  type Integration,
  parseReadinessPhase,
  safeCode,
  VERSION_PATTERN,
} from "../../lib/integrations.ts";
import type { Env } from "../env.ts";
import type { OpenEhrClient, OpenEhrError } from "../openehr/index.ts";
import { getOpenEhrClient } from "../openehr/index.ts";
import { readCapped } from "../read-capped.ts";

/**
 * One check: FerroEHR through the openEHR client, or a method on a FerroBRIDGE URL from the
 * configuration.
 */
export type ProbeTarget =
  | { integration: "ferroehr"; via: "openehr_client" }
  | { integration: "ferrobridge"; via: "http"; method: "GET"; url: URL };

/**
 * The outcome of one check: its state, timing and class, and the codes each integration's
 * detail holds. Nothing else from a response: no URL, header, token or body.
 */
export interface CheckResult {
  integration: Integration;
  state: CheckState;
  checkedAt: Date;
  /** Milliseconds until the last response arrived; `null` when none did. */
  responseTimeMs: number | null;
  errorClass: CheckErrorClass | null;
  /** Set for FerroEHR only. */
  ferroehr: FerroEhrDetail | null;
  /** Set for FerroBRIDGE only. */
  ferrobridge: FerroBridgeDetail | null;
}

/** The `fetch` the check uses; a test passes a stub. */
export type ProbeFetch = (url: URL, init: RequestInit) => Promise<Response>;

/** What a check runs with: the openEHR client, the HTTP client, the clock and the timer. */
export interface ProbeDeps {
  openEhr: Pick<OpenEhrClient, "options" | "listTemplates">;
  fetch: ProbeFetch;
  now: () => Date;
  /** A monotonic clock in milliseconds (`performance.now`). */
  elapsed: () => number;
}

// NOTE: no requirement governs this: our own design. Five seconds per FerroEHR call (the token
// request keeps the client's own timeout) keeps a whole check under the 60 s schedule.
export const CHECK_TIMEOUT_MS = 5_000;

// NOTE: no requirement governs this: our own design. The check reads only whether the answer is
// a JSON object and, for a FerroBRIDGE 503, its indicators; a larger body is not a health answer.
export const CHECK_BODY_LIMIT_BYTES = 64 * 1024;

// NOTE: no requirement governs this: our own design; more failing indicators than this are cut.
export const MAX_FAILING_INDICATORS = 16;

/**
 * FerroBRIDGE's readiness answer (FerroBRIDGE book v0.0.24, `operate/container.md`): the
 * aggregate `state`, the `phase`, and every indicator with its `state`, never why it is down.
 */
const readinessAnswer = z.object({
  state: z.string(),
  phase: z.string().optional(),
  indicators: z.array(z.object({ name: z.string(), state: z.string() })).max(256),
});

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Returns the two checks, built from configuration only.
 *
 * FerroEHR: the openEHR client's `options()` and `listTemplates()` (ITS-REST 1.1.0, System API
 * "Options and Conformance" and Definition API "List templates"). FerroBRIDGE:
 * `GET /health/readiness` beside its base URL.
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

/** Returns the parsed JSON when `text` is a JSON object, else `undefined`. */
function jsonObject(text: string): object | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
  } catch {
    // NOTE: a body that does not parse is a finding of the check, reported as its class.
    return undefined;
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

/** Returns the state of a failed call: refused for an authentication refusal (#35). */
function failedState(errorClass: CheckErrorClass): "refused" | "unavailable" {
  // NOTE: owner decision on #35: a 401 or 403 shows as refused, not as unavailable.
  return errorClass === "auth_refused" ? "refused" : "unavailable";
}

/** Returns the refusal code of an openEHR error, when it is an authentication refusal. */
function authReason(error: OpenEhrError): string | null {
  return error.kind === "auth_refused" ? safeCode(error.reason, AUTH_REASON_PATTERN) : null;
}

/** Returns the FerroBRIDGE indicators that are not up, by name, unique and in their order. */
export function failingIndicators(indicators: readonly { name: string; state: string }[]) {
  const names = indicators
    .filter((indicator) => indicator.state !== "up")
    .flatMap((indicator) => safeCode(indicator.name, INDICATOR_PATTERN) ?? []);
  return [...new Set(names)].slice(0, MAX_FAILING_INDICATORS);
}

type Finish = (
  state: CheckState,
  errorClass: CheckErrorClass | null,
  responded: boolean,
  detail: Pick<CheckResult, "ferroehr" | "ferrobridge">,
) => CheckResult;

/**
 * Checks FerroEHR in three steps (#227): the manifest answers (reachable), a token is obtained
 * and the template list is read with it (signed in), and the eduLIMS template is in that list
 * (template loaded). A step after a failed one is skipped.
 */
async function probeFerroEhr(deps: ProbeDeps, finish: Finish): Promise<CheckResult> {
  const detail = (
    steps: FerroEhrSteps,
    rest: Partial<Omit<FerroEhrDetail, "steps">> = {},
  ): Pick<CheckResult, "ferroehr" | "ferrobridge"> => ({
    ferroehr: {
      steps,
      serverVersion: rest.serverVersion ?? null,
      specVersion: rest.specVersion ?? null,
      signInTarget: rest.signInTarget ?? null,
      authReason: rest.authReason ?? null,
    },
    ferrobridge: null,
  });
  const manifest = await deps.openEhr.options({ timeoutMs: CHECK_TIMEOUT_MS });
  if (!manifest.ok) {
    const errorClass = openEhrErrorClass(manifest.error);
    const state = failedState(errorClass);
    const responded = errorClass !== "timeout" && errorClass !== "unreachable";
    const steps: FerroEhrSteps = {
      reachable: state === "refused" ? "refused" : "failed",
      signed_in: "skipped",
      template_loaded: "skipped",
    };
    return finish(
      state,
      errorClass,
      responded,
      detail(steps, { authReason: authReason(manifest.error) }),
    );
  }
  const versions = {
    serverVersion: safeCode(manifest.value.solution_version, VERSION_PATTERN),
    specVersion: safeCode(manifest.value.restapi_specs_version, VERSION_PATTERN),
  };
  const templates = await deps.openEhr.listTemplates({ timeoutMs: CHECK_TIMEOUT_MS });
  if (!templates.ok) {
    const errorClass = openEhrErrorClass(templates.error);
    const state = failedState(errorClass);
    const steps: FerroEhrSteps = {
      reachable: "passed",
      signed_in: state === "refused" ? "refused" : "failed",
      template_loaded: "skipped",
    };
    return finish(
      state,
      errorClass,
      true,
      detail(steps, {
        ...versions,
        signInTarget: templates.error.target,
        authReason: authReason(templates.error),
      }),
    );
  }
  const loaded = templates.value.some((template) => template.template_id === EDULIMS_TEMPLATE_ID);
  const steps: FerroEhrSteps = {
    reachable: "passed",
    signed_in: "passed",
    template_loaded: loaded ? "passed" : "missing",
  };
  // NOTE: #227: a missing template is FerroEHR's configuration (#146), so it shows as not ready.
  return loaded
    ? finish("available", null, true, detail(steps, versions))
    : finish("not_ready", "template_missing", true, detail(steps, versions));
}

/**
 * Checks FerroBRIDGE's readiness: a 200 with a JSON object is ready; a 503 with the readiness
 * document is not ready, naming the indicators that are not up and the phase.
 */
async function probeFerroBridge(
  target: Extract<ProbeTarget, { via: "http" }>,
  deps: ProbeDeps,
  finish: Finish,
): Promise<CheckResult> {
  const detail = (
    rest: Partial<FerroBridgeDetail> = {},
  ): Pick<CheckResult, "ferroehr" | "ferrobridge"> => ({
    ferroehr: null,
    ferrobridge: { phase: rest.phase ?? null, failingIndicators: rest.failingIndicators ?? [] },
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
    return finish("unavailable", requestErrorClass(error), false, detail());
  }
  const ready = response.status >= 200 && response.status <= 299;
  if (!ready && response.status !== 503) {
    await response.body?.cancel();
    const errorClass = statusErrorClass(response.status);
    return finish(failedState(errorClass), errorClass, true, detail());
  }
  let body: string | undefined;
  try {
    body = await readCapped(response, CHECK_BODY_LIMIT_BYTES);
  } catch (error) {
    return finish("unavailable", requestErrorClass(error), true, detail());
  }
  const json = body === undefined ? undefined : jsonObject(body);
  if (ready) {
    return json === undefined
      ? finish("unavailable", "unexpected_response", true, detail())
      : finish("available", null, true, detail());
  }
  const readiness = readinessAnswer.safeParse(json);
  if (!readiness.success) return finish("unavailable", "http_server_error", true, detail());
  // NOTE: FerroBRIDGE book v0.0.24, `operate/container.md`: readiness answers 503 while booting,
  // draining or with an indicator down; the body names the indicators, never why.
  return finish(
    "not_ready",
    "readiness_down",
    true,
    detail({
      phase: parseReadinessPhase(readiness.data.phase) ?? null,
      failingIndicators: failingIndicators(readiness.data.indicators),
    }),
  );
}

/** Checks one integration and returns its result; it never throws for a failing service. */
export async function probe(target: ProbeTarget, deps: ProbeDeps): Promise<CheckResult> {
  const started = deps.elapsed();
  const finish: Finish = (state, errorClass, responded, detail) => ({
    integration: target.integration,
    state,
    checkedAt: deps.now(),
    responseTimeMs: responded ? Math.max(0, Math.round(deps.elapsed() - started)) : null,
    errorClass,
    ...detail,
  });
  return target.via === "openehr_client"
    ? probeFerroEhr(deps, finish)
    : probeFerroBridge(target, deps, finish);
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
