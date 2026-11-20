// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The log line of input that a server function refuses at validation (ASVS 5.0 V16.3.3, #304).
// The global function middleware `inputRefusalLogMiddleware` (src/server/middleware.ts) writes it.
// Relative imports, as in security-log.ts.
import "@tanstack/react-start/server-only";
import { toRequestId } from "./audit/events.ts";
import { logSecurityEvent } from "./security-log.ts";

/** The most issues one log line names; the line counts them all in `refused_count`. */
export const REFUSAL_ISSUES_MAX = 10;

/** One refused issue: where in the input it is and its code. Never the value. */
export interface RefusedIssue {
  readonly path: readonly string[];
  readonly code: string;
}

// NOTE: ASVS V16.2.5; no input schema has a record or catch-all, so a segment is a schema key.
/** A path segment written as is: an array index or a schema key; anything else is replaced. */
const SEGMENT = /^(?:\d{1,6}|[A-Za-z_][A-Za-z0-9_]{0,63})$/;
/** An issue code as Zod writes it (`invalid_format`, `too_big`, `custom`). */
const CODE = /^[a-z][a-z_]{0,31}$/;
/** Written in place of a path segment or a code that does not match its pattern. */
const UNKNOWN = "unknown";

function segment(item: unknown): string {
  const key = typeof item === "object" && item !== null && "key" in item ? item.key : item;
  const text = typeof key === "number" ? String(key) : key;
  return typeof text === "string" && SEGMENT.test(text) ? text : UNKNOWN;
}

function refusedIssue(item: unknown): RefusedIssue | null {
  if (typeof item !== "object" || item === null) return null;
  if (!("message" in item) || typeof item.message !== "string") return null;
  const path = "path" in item && Array.isArray(item.path) ? item.path.map(segment) : [];
  const code =
    "code" in item && typeof item.code === "string" && CODE.test(item.code) ? item.code : UNKNOWN;
  return { path, code };
}

/**
 * Returns the issues of a validator refusal, or `null` when `error` is something else. Start
 * throws a refusal as a plain `Error` whose message is the Standard Schema issue list as JSON
 * (`execValidator` in `@tanstack/start-client-core`); the issues keep only their paths and codes.
 */
export function validationIssues(error: unknown): RefusedIssue[] | null {
  if (!(error instanceof Error) || Object.getPrototypeOf(error) !== Error.prototype) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(error.message);
  } catch {
    // NOTE: no requirement governs this: our own design; a message that is not JSON is no refusal.
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const issues: RefusedIssue[] = [];
  for (const item of parsed) {
    const issue = refusedIssue(item);
    if (issue === null) return null;
    issues.push(issue);
  }
  return issues;
}

/** Returns the first {@link REFUSAL_ISSUES_MAX} issues as `path:code` (`labId:invalid_format`). */
export function issueCodes(issues: readonly RefusedIssue[]): string[] {
  return issues
    .slice(0, REFUSAL_ISSUES_MAX)
    .map((issue) => `${issue.path.join(".")}:${issue.code}`);
}

/** The refusals already logged: a server function called from another rethrows the same one. */
const logged = new WeakSet<Error>();

/** The user each request's session middleware resolved, keyed by the request's headers. */
const actors = new WeakMap<Headers, string>();

/** Records the session user of the request whose headers are `headers`, for a refusal line. */
export function noteRequestActor(headers: Headers, userId: string): void {
  actors.set(headers, userId);
}

/**
 * Writes one `input_validation_fail` line (OWASP Logging Vocabulary): the server function, the
 * refused paths and codes, their count, the user its session middleware resolved (a function
 * without one logs `anonymous`) and the request id. Never the refused value.
 */
export function logInputRefusal(
  headers: Headers,
  serverFn: string,
  issues: readonly RefusedIssue[],
): void {
  const userId = actors.get(headers);
  logSecurityEvent("warn", "input_validation_fail", {
    outcome: "refused",
    reason: "invalid_input",
    actor_type: userId === undefined ? "anonymous" : "user",
    actor_id: userId,
    server_fn: serverFn,
    issues: issueCodes(issues),
    refused_count: issues.length,
    request_id: toRequestId(headers.get("x-request-id")),
  });
}

/**
 * Logs `error` with {@link logInputRefusal} when it is a validator refusal
 * ({@link validationIssues}) not logged before, and does nothing otherwise. A refusal that
 * passes through the chain of an outer server function is logged once, by the innermost.
 */
export function logValidationRefusal(error: unknown, headers: Headers, serverFn: string): void {
  const issues = validationIssues(error);
  if (issues === null || !(error instanceof Error) || logged.has(error)) return;
  logged.add(error);
  logInputRefusal(headers, serverFn, issues);
}
