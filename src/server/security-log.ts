// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The security event stream on stdout: one JSON object per line, for the container runtime's log
// driver to keep or ship off the host (ASVS V16.2.4, V16.4.3). Ids and codes only (V16.2.5).
// Relative imports: `pnpm db:seed` loads this in plain Node.
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
  "kind",
  "status",
] as const;
export type SecurityLogField = (typeof SECURITY_LOG_FIELDS)[number];

/** The fields of one line; a field left `undefined` is left out. */
export type SecurityLogFields = Partial<Record<SecurityLogField, string | number | undefined>>;

/**
 * The shape every string value must have: an id, a code, a role list or an ISO timestamp. No
 * `@` and no space, so an e-mail address or a full name cannot pass.
 */
export const SECURITY_LOG_VALUE = /^[A-Za-z0-9._:,+-]{1,128}$/;

/** The value written in place of a string that fails {@link SECURITY_LOG_VALUE}. */
export const REDACTED = "redacted";

/** Writes one line; replaced in tests. */
export type LineWriter = (line: string) => void;

const writeStdout: LineWriter = (line) => {
  process.stdout.write(line);
};

let writer: LineWriter = writeStdout;

/** Replaces where lines go and returns a function that restores stdout (tests only). */
export function setSecurityLogWriter(next: LineWriter): () => void {
  writer = next;
  return () => {
    writer = writeStdout;
  };
}

function safeValue(value: string | number): string | number {
  if (typeof value === "number") return Number.isFinite(value) ? value : REDACTED;
  return SECURITY_LOG_VALUE.test(value) ? value : REDACTED;
}

/**
 * Returns the JSON line (with its newline) for one security event: the allowed fields only, in
 * a fixed order, each string value checked against {@link SECURITY_LOG_VALUE}.
 */
export function formatSecurityLine(
  level: SecurityLogLevel,
  event: string,
  fields: SecurityLogFields,
  now: Date = new Date(),
): string {
  const line: Record<string, string | number> = {
    time: now.toISOString(),
    level,
    app: "edulims",
    log: "security",
    event: safeValue(event),
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
    fields: event.metadata?.fields?.join(","),
    attest_pkce: event.metadata?.attest_pkce === true ? "true" : undefined,
    sessions_ended: event.metadata?.sessions_ended,
    test_outcome: event.metadata?.test_outcome,
    removed_audit_events: event.metadata?.removed_audit_events,
    removed_sessions: event.metadata?.removed_sessions,
    removed_admin_grants: event.metadata?.removed_admin_grants,
    analyser_status: event.metadata?.analyser_status,
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
