// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The vocabulary of the integration status (B3, #35), shared by the server check and the screen.

/** The integrations eduLIMS checks: the openEHR CDR and the HL7 v2 bridge. */
export const INTEGRATIONS = ["ferroehr", "ferrobridge"] as const;
export type Integration = (typeof INTEGRATIONS)[number];

/**
 * The outcome of one check: `refused` when the service answers but refuses eduLIMS's
 * credentials (401 or 403), since it is reachable and only its access needs fixing;
 * `not_ready` when it answers and accepts eduLIMS but cannot take its data yet (FerroEHR without
 * the eduLIMS template, FerroBRIDGE whose readiness is down).
 */
export const CHECK_STATES = ["available", "unavailable", "refused", "not_ready"] as const;
export type CheckState = (typeof CHECK_STATES)[number];

/**
 * Why a check failed, as a class from a fixed list: no URL, status text or response body is
 * stored or shown, so nothing about the target or its answer leaks (ASVS V16.2.5).
 */
export const CHECK_ERROR_CLASSES = [
  "timeout",
  "unreachable",
  "auth_refused",
  "http_client_error",
  "http_server_error",
  "unexpected_response",
  "template_missing",
  "readiness_down",
] as const;
export type CheckErrorClass = (typeof CHECK_ERROR_CLASSES)[number];

/**
 * What the screen shows for an integration: the state of its latest check, `not_checked` before
 * the first one, and `unknown` when the latest is older than {@link STALE_CHECK_MS}.
 */
export type IntegrationDisplayState = CheckState | "not_checked" | "unknown";

// NOTE: B3 ("within 5 minutes"); a result older than that no longer says the integration is
// reachable now, so the screen shows it as unknown.
export const STALE_CHECK_MS = 5 * 60_000;

/**
 * The steps of the FerroEHR check, in order: the conformance manifest answers (`reachable`),
 * eduLIMS obtains a token and one authenticated read succeeds (`signed_in`), and the template
 * eduLIMS writes is in FerroEHR's template list (`template_loaded`).
 */
export const FERROEHR_STEPS = ["reachable", "signed_in", "template_loaded"] as const;
export type FerroEhrStep = (typeof FERROEHR_STEPS)[number];

/**
 * The outcome of one step: `missing` for a template FerroEHR does not hold, and `skipped` when
 * an earlier step failed, so this one could not run.
 */
export const STEP_STATES = ["passed", "failed", "refused", "missing", "skipped"] as const;
export type StepState = (typeof STEP_STATES)[number];

/** The outcome of each FerroEHR step. */
export type FerroEhrSteps = Readonly<Record<FerroEhrStep, StepState>>;

/** Which service refused or failed the sign-in step: the OAuth2 token endpoint or FerroEHR. */
export const SIGN_IN_TARGETS = ["token_endpoint", "ferroehr"] as const;
export type SignInTarget = (typeof SIGN_IN_TARGETS)[number];

// NOTE: #146 (docker/ferroehr/definitions/eduLIMS-lab.v1.opt): the operational template eduLIMS
// writes its measurements with; the check looks for this id in the Definition API's list.
export const EDULIMS_TEMPLATE_ID = "eduLIMS-lab.v1";

/**
 * The shape a version string from FerroEHR's manifest must have to be stored and shown: a
 * version, never free text from the answer.
 */
export const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;

/** The shape of an OAuth2 or openEHR refusal code that is stored and shown (RFC 6749 §5.2). */
export const AUTH_REASON_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/** The shape of a FerroBRIDGE readiness indicator name that is stored and shown. */
export const INDICATOR_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** The phases FerroBRIDGE's readiness answer names (FerroBRIDGE book v0.0.24, "Container"). */
export const READINESS_PHASES = ["booting", "serving", "draining"] as const;
export type ReadinessPhase = (typeof READINESS_PHASES)[number];

/** What a FerroEHR check found beside its state: each step, the versions and a refusal's code. */
export interface FerroEhrDetail {
  steps: FerroEhrSteps;
  /** FerroEHR's `solution_version` and `restapi_specs_version` from the manifest, when valid. */
  serverVersion: string | null;
  specVersion: string | null;
  /** Which service failed or refused the sign-in step; `null` when it passed or did not run. */
  signInTarget: SignInTarget | null;
  /** The `error` code of a refused token or call (RFC 6749 §5.2, RFC 6750 §3.1). */
  authReason: string | null;
}

/** What a FerroBRIDGE check found beside its state: its phase and the indicators not up. */
export interface FerroBridgeDetail {
  phase: ReadinessPhase | null;
  failingIndicators: readonly string[];
}

/** Returns the first FerroEHR step that did not pass, or `null` when every step passed. */
export function failedStep(steps: FerroEhrSteps): FerroEhrStep | null {
  return FERROEHR_STEPS.find((step) => steps[step] !== "passed") ?? null;
}

/** Returns `value` when it names an {@link Integration}, else `undefined`. */
export function parseIntegration(value: unknown): Integration | undefined {
  return INTEGRATIONS.find((integration) => integration === value);
}

/** Returns `value` when it names a {@link CheckState}, else `undefined`. */
export function parseCheckState(value: unknown): CheckState | undefined {
  return CHECK_STATES.find((state) => state === value);
}

/** Returns `value` when it names a {@link CheckErrorClass}, else `undefined`. */
export function parseCheckErrorClass(value: unknown): CheckErrorClass | undefined {
  return CHECK_ERROR_CLASSES.find((errorClass) => errorClass === value);
}

/** Returns `value` when it names a {@link StepState}, else `undefined`. */
export function parseStepState(value: unknown): StepState | undefined {
  return STEP_STATES.find((state) => state === value);
}

/** Returns `value` when it names a {@link SignInTarget}, else `undefined`. */
export function parseSignInTarget(value: unknown): SignInTarget | undefined {
  return SIGN_IN_TARGETS.find((target) => target === value);
}

/** Returns `value` when it names a {@link ReadinessPhase}, else `undefined`. */
export function parseReadinessPhase(value: unknown): ReadinessPhase | undefined {
  return READINESS_PHASES.find((phase) => phase === value);
}

/** Returns `value` when it matches `pattern`, else `null`: a code from a service, never text. */
export function safeCode(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}
