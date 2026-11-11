// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The vocabulary of the integration status (B3, #35), shared by the server check and the screen.

/** The integrations eduLIMS checks: the openEHR CDR and the HL7 v2 bridge. */
export const INTEGRATIONS = ["ferroehr", "ferrobridge"] as const;
export type Integration = (typeof INTEGRATIONS)[number];

/**
 * The outcome of one check: `refused` when the service answers but refuses eduLIMS's
 * credentials (401 or 403), since it is reachable and only its access needs fixing.
 */
export const CHECK_STATES = ["available", "unavailable", "refused"] as const;
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
