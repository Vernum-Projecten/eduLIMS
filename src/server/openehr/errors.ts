// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The typed failures of the openEHR client. Each one carries ids, statuses and codes only: never
// a URL, a header, a token, a secret or a response body, so a failure is safe to log as it is.
import "@tanstack/react-start/server-only";

/** Which service a failure came from: the OAuth2 token endpoint or FerroEHR itself. */
export type OpenEhrTarget = "token_endpoint" | "ferroehr";

/** Why a response could not be used, although the service answered. */
export type InvalidResponseProblem = "too_large" | "not_json" | "unexpected_shape";

/**
 * A failed call to FerroEHR, as a discriminated union on `kind`.
 *
 * - `unreachable`: no connection (DNS, refused, reset).
 * - `timeout`: no complete answer within the call's timeout.
 * - `auth_refused`: the token endpoint refused the client credentials (RFC 6749 §5.2), or
 *   FerroEHR refused the token with 401 or 403 (RFC 6750 §3.1); `reason` is the `error` code.
 * - `refused`: any other non-success answer, with its status and the openEHR error code.
 * - `invalid_response`: a success status with a body the client cannot use.
 */
export type OpenEhrError =
  | { kind: "unreachable"; target: OpenEhrTarget; cause: unknown }
  | { kind: "timeout"; target: OpenEhrTarget; cause: unknown }
  | { kind: "auth_refused"; target: OpenEhrTarget; status: number; reason: string | null }
  | { kind: "refused"; target: OpenEhrTarget; status: number; code: string | null }
  | {
      kind: "invalid_response";
      target: OpenEhrTarget;
      status: number;
      problem: InvalidResponseProblem;
      cause?: unknown;
    };

/** The result of a client call: the value, or a typed {@link OpenEhrError}. */
export type OpenEhrResult<T> = { ok: true; value: T } | { ok: false; error: OpenEhrError };

/** Wraps a value as a successful {@link OpenEhrResult}. */
export function success<T>(value: T): OpenEhrResult<T> {
  return { ok: true, value };
}

/** Wraps an error as a failed {@link OpenEhrResult}. */
export function failure<T>(error: OpenEhrError): OpenEhrResult<T> {
  return { ok: false, error };
}

/** Returns whether a rejected `fetch` or body read is a timeout (or an abort) of its signal. */
export function isTimeout(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/** Classifies a rejected request as a timeout or an unreachable service. */
export function requestFailure(target: OpenEhrTarget, cause: unknown): OpenEhrError {
  return isTimeout(cause)
    ? { kind: "timeout", target, cause }
    : { kind: "unreachable", target, cause };
}

// NOTE: RFC 6749 §5.2 and RFC 6750 §3: an `error` code is limited to these characters; anything
// else is dropped, so a hostile service cannot put free text into a log line.
const ERROR_CODE = /^[\x20\x21\x23-\x5B\x5D-\x7E]{1,64}$/;

/** Returns `value` when it is a well-formed OAuth2 `error` code, else `null`. */
export function oauthErrorCode(value: unknown): string | null {
  return typeof value === "string" && ERROR_CODE.test(value) ? value : null;
}

// NOTE: FerroEHR book v5.7.0, `using-the-api/problems.md`: a problem `type` is the problems page
// at the type's anchor; the anchor is the code.
const PROBLEM_TYPE = /\/problems\.html#([a-z0-9-]{1,64})$/;

/**
 * Returns the openEHR error code of an error body, or `null` when it names none.
 *
 * FerroEHR answers RFC 9457 problem details, whose `type` anchor is the code
 * (`validation-failed`); ITS-REST 1.1.0 (`overview/Requests_and_responses.md`, "HTTP status
 * codes") shows a numeric `code` member, which is read as a fallback.
 */
export function openEhrErrorCode(body: string | undefined): string | null {
  if (!body) return null;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    // NOTE: no openEHR spec requires an error body; one that is not JSON names no code.
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  if ("type" in value && typeof value.type === "string") {
    const match = PROBLEM_TYPE.exec(value.type);
    if (match?.[1]) return match[1];
  }
  if ("code" in value) {
    const code = value.code;
    if (typeof code === "number" && Number.isInteger(code)) return String(code);
    if (typeof code === "string") return oauthErrorCode(code);
  }
  return null;
}

/**
 * Returns the `error` parameter of a Bearer `WWW-Authenticate` challenge (RFC 6750 §3), such
 * as `invalid_token` or `insufficient_scope`, or `null` when it carries none.
 */
export function bearerChallengeError(header: string | null): string | null {
  if (!header) return null;
  const match = /\berror="([^"]*)"/i.exec(header);
  return oauthErrorCode(match?.[1]);
}

/**
 * Returns a log-safe one-line description of an error: its kind, target, status and code.
 * The cause is named by its error name only.
 */
export function describeOpenEhrError(error: OpenEhrError): string {
  switch (error.kind) {
    case "unreachable":
    case "timeout": {
      const cause = error.cause instanceof Error ? error.cause.name : typeof error.cause;
      return `openehr_${error.kind} target=${error.target} cause=${cause}`;
    }
    case "auth_refused":
      return `openehr_auth_refused target=${error.target} status=${error.status} reason=${error.reason ?? "none"}`;
    case "refused":
      return `openehr_refused target=${error.target} status=${error.status} code=${error.code ?? "none"}`;
    case "invalid_response":
      return `openehr_invalid_response target=${error.target} status=${error.status} problem=${error.problem}`;
    default: {
      const unhandled: never = error;
      return String(unhandled);
    }
  }
}
