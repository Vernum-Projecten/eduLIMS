// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The security event stream on stdout: one JSON object per line, for the container runtime's log
// driver to keep or ship off the host (ASVS V16.2.4, V16.4.3). Ids and codes only (V16.2.5).
// Relative imports: `pnpm db:seed` and the host CLI load this in plain Node.
import "@tanstack/react-start/server-only";
import { formatRoles, type Role } from "../lib/roles.ts";
import { type AuditEvent, toRequestId } from "./audit/events.ts";

/** The level of a security log line, after the OWASP Logging Vocabulary cheat sheet. */
export type SecurityLogLevel = "info" | "warn" | "error";

/**
 * The only keys a security log line carries beside `time`, `level`, `app`, `log` and `event`.
 * None of them has room for a name, an e-mail address, a token, a request body or a grade.
 */
export const SECURITY_LOG_FIELDS = [
  "outcome",
  "actor_type",
  "actor_id",
  "target_type",
  "target_id",
  "reason",
  "provider",
  "request_id",
  "roles",
  "previous_roles",
  "required_roles",
  "ban_expires_at",
  "provider_id",
  "protocol",
  "fields",
  "attest_pkce",
  "sessions_ended",
  "test_outcome",
  "removed_audit_events",
  "removed_sessions",
  "removed_admin_grants",
  "analyser_status",
  "token_expires_at",
  "previous_token_valid_until",
  "refused_count",
  "resealed_providers",
  "resealed_id_tokens",
  "kind",
  "status",
  "command",
  "migration",
  "direction",
  "variables",
  "cause",
] as const;
export type SecurityLogField = (typeof SECURITY_LOG_FIELDS)[number];

/** One field value: an id or a code, a count, or a list of codes (`fields`, `cause`). */
export type SecurityLogValue = string | number | readonly string[];

/** The fields of one line; a field left `undefined` is left out. */
export type SecurityLogFields = Partial<Record<SecurityLogField, SecurityLogValue | undefined>>;

/**
 * The shape every string value and every list item must have: an id, a code, a role list or an
 * ISO timestamp. No `@` and no space, so an e-mail address or a full name cannot pass.
 */
export const SECURITY_LOG_VALUE = /^[A-Za-z0-9._:,+-]{1,128}$/;

/** The value written in place of a string that fails {@link SECURITY_LOG_VALUE}. */
export const REDACTED = "redacted";

/** The longest list a field may carry; a longer one is written as {@link REDACTED}. */
export const SECURITY_LOG_LIST_MAX = 64;

/** Writes one line; replaced in tests. */
export type LineWriter = (line: string) => void;

const writeStdout: LineWriter = (line) => {
  process.stdout.write(line);
};

let writer: LineWriter = writeStdout;

/** Replaces where lines go and returns a function that restores the writer before it (tests). */
export function setSecurityLogWriter(next: LineWriter): () => void {
  const previous = writer;
  writer = next;
  return () => {
    writer = previous;
  };
}

function safeScalar(value: string | number): string | number {
  if (typeof value === "number") return Number.isFinite(value) ? value : REDACTED;
  return SECURITY_LOG_VALUE.test(value) ? value : REDACTED;
}

function safeValue(value: SecurityLogValue): string | number | string[] {
  if (typeof value === "string" || typeof value === "number") return safeScalar(value);
  if (value.length > SECURITY_LOG_LIST_MAX) return REDACTED;
  return value.map((item) => (SECURITY_LOG_VALUE.test(item) ? item : REDACTED));
}

/**
 * Returns the JSON line (with its newline) for one security event: the allowed fields only, in
 * a fixed order, each string value and each list item checked against
 * {@link SECURITY_LOG_VALUE}.
 */
export function formatSecurityLine(
  level: SecurityLogLevel,
  event: string,
  fields: SecurityLogFields,
  now: Date = new Date(),
): string {
  const line: Record<string, string | number | string[]> = {
    time: now.toISOString(),
    level,
    app: "edulims",
    log: "security",
    event: safeScalar(event),
  };
  for (const key of SECURITY_LOG_FIELDS) {
    const value = fields[key];
    if (value !== undefined) line[key] = safeValue(value);
  }
  // NOTE: V16.4.1; JSON.stringify escapes control characters, so one event is one line.
  return `${JSON.stringify(line)}\n`;
}

/** Writes one security event to stdout as a JSON line ({@link formatSecurityLine}). */
export function logSecurityEvent(
  level: SecurityLogLevel,
  event: string,
  fields: SecurityLogFields,
): void {
  writer(formatSecurityLine(level, event, fields));
}

function errorCode(error: object): string | undefined {
  return "code" in error &&
    typeof error.code === "string" &&
    /^[A-Za-z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : undefined;
}

/**
 * Returns the cause chain of a failure as codes, outermost first: each error's class name, with
 * its code after a colon when it has one (a SQLSTATE, `ECONNREFUSED`). Never a message, which
 * could quote a row.
 */
export function failureCause(error: unknown): string[] {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (typeof current !== "object") {
      parts.push(typeof current);
      break;
    }
    const name = current instanceof Error ? current.name : "object";
    const code = errorCode(current);
    parts.push(code === undefined ? name : `${name}:${code}`);
    current = "cause" in current ? current.cause : undefined;
  }
  return parts;
}

/**
 * Writes a failure to the security stream at level `error`: `fields` plus its cause chain
 * ({@link failureCause}), never its message (ASVS V16.2.1, V16.2.5).
 */
export function logFailure(event: string, error: unknown, fields: SecurityLogFields = {}): void {
  logSecurityEvent("error", event, { ...fields, cause: failureCause(error) });
}

/** Returns the log fields of an activity-log event: its ids and codes, never more. */
export function auditLogFields(event: AuditEvent): SecurityLogFields {
  return {
    outcome: event.outcome,
    actor_type: event.actor.type,
    actor_id: event.actor.type === "user" ? event.actor.id : undefined,
    target_type: event.target?.type,
    target_id: event.target?.id,
    reason: event.reason,
    provider: event.provider,
    request_id: event.requestId,
    roles: event.metadata?.roles,
    previous_roles: event.metadata?.previous_roles,
    ban_expires_at: event.metadata?.ban_expires_at,
    provider_id: event.metadata?.provider_id,
    protocol: event.metadata?.protocol,
    fields: event.metadata?.fields,
    attest_pkce: event.metadata?.attest_pkce === true ? "true" : undefined,
    sessions_ended: event.metadata?.sessions_ended,
    test_outcome: event.metadata?.test_outcome,
    removed_audit_events: event.metadata?.removed_audit_events,
    removed_sessions: event.metadata?.removed_sessions,
    removed_admin_grants: event.metadata?.removed_admin_grants,
    analyser_status: event.metadata?.analyser_status,
    token_expires_at: event.metadata?.token_expires_at,
    previous_token_valid_until: event.metadata?.previous_token_valid_until,
    refused_count: event.metadata?.refused_count,
    resealed_providers: event.metadata?.resealed_providers,
    resealed_id_tokens: event.metadata?.resealed_id_tokens,
  };
}

/** Returns the level of an activity-log event: a refusal warns, a failure is an error. */
export function auditLogLevel(event: AuditEvent): SecurityLogLevel {
  if (event.outcome === "failure") return event.action === "authn_login_fail" ? "warn" : "error";
  return event.outcome === "refused" ? "warn" : "info";
}

/** Writes an activity-log event to the security stream. */
export function logAuditEvent(event: AuditEvent): void {
  logSecurityEvent(auditLogLevel(event), event.action, auditLogFields(event));
}

/**
 * Writes a refused server function call to the security stream as `authz_fail` (ASVS V16.3.2):
 * the user id when there is one, the status, the roles the function needs and the request id
 * the reverse proxy set.
 */
export function logAuthzFailure(
  headers: Headers,
  status: 401 | 403,
  userId?: string,
  requiredRoles: readonly Role[] = [],
): void {
  logSecurityEvent("warn", "authz_fail", {
    outcome: "refused",
    actor_type: userId ? "user" : "anonymous",
    actor_id: userId,
    reason: status === 401 ? "not_signed_in" : "missing_role",
    status,
    required_roles: requiredRoles.length > 0 ? formatRoles(requiredRoles) : undefined,
    request_id: toRequestId(headers.get("x-request-id")),
  });
}
