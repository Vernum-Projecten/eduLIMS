// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Writing the activity log (B4). Relative imports: `pnpm db:seed` loads this in plain Node.
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { logAuditEvent, logSecurityEvent } from "../security-log.ts";
import { type AuditEvent, auditEventSchema } from "./events.ts";

/** Thrown when an event fails {@link auditEventSchema}: a coding error, never user input. */
export class AuditEventInvalidError extends Error {
  override readonly name = "AuditEventInvalidError";
  readonly kind = "audit_event_invalid";
}

/** Thrown when the database refuses or cannot take an activity-log row. */
export class AuditWriteError extends Error {
  override readonly name = "AuditWriteError";
  readonly kind = "audit_write_failed";
}

/**
 * Writes one event to `audit_event` through `db`, which may be a transaction.
 *
 * Pass the transaction of the action the event describes, so the action and its log row commit
 * or roll back together: an action that cannot be logged does not happen.
 *
 * After the insert it writes the same ids and codes to the security log on stdout
 * ({@link logAuditEvent}), unless `options.stdout` is `false` (the demo seed's back-dated rows).
 *
 * @throws AuditEventInvalidError when the event fails the schema (an unknown metadata key, a
 * target type that does not fit the action).
 * @throws AuditWriteError when the insert fails.
 */
export async function recordAudit(
  db: Kysely<DB>,
  event: AuditEvent,
  options: { stdout?: boolean } = {},
): Promise<void> {
  const parsed = auditEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new AuditEventInvalidError(`invalid audit event ${event.action}`, {
      cause: parsed.error,
    });
  }
  const { action, actor, outcome, target, reason, provider, requestId, occurredAt, metadata } =
    parsed.data;
  try {
    await db
      .insertInto("audit_event")
      .values({
        action,
        actor_type: actor.type,
        actor_id: actor.type === "user" ? actor.id : null,
        outcome,
        target_type: target?.type ?? null,
        target_id: target?.id ?? null,
        reason_code: reason ?? null,
        provider: provider ?? null,
        request_id: requestId ?? null,
        metadata: metadata === undefined ? null : JSON.stringify(metadata),
        ...(occurredAt ? { occurred_at: occurredAt } : {}),
      })
      .execute();
  } catch (error) {
    throw new AuditWriteError(`audit write failed for ${action}`, { cause: error });
  }
  // NOTE: V16.4.3; written inside the caller's transaction, so a later rollback can leave a line
  // for a row that never committed. The activity log stays the record; the stream is its copy.
  if (options.stdout !== false) logAuditEvent(event);
}

/**
 * Writes the log row of an action that has already committed elsewhere (better-auth's own
 * writes). A failed write cannot undo that action, so it goes to the server's error log with the
 * action and the ids, the second place an operator looks, and the caller's flow continues.
 */
export async function recordCommittedAudit(db: Kysely<DB>, event: AuditEvent): Promise<void> {
  try {
    await recordAudit(db, event);
  } catch (error) {
    // Ids and codes only, never the names or the request (A09, privacy).
    logSecurityEvent("error", "audit_write_failed", {
      kind: error instanceof AuditEventInvalidError ? "invalid" : "write",
      reason: event.action,
      outcome: event.outcome,
      actor_type: event.actor.type,
      actor_id: event.actor.type === "user" ? event.actor.id : undefined,
      target_type: event.target?.type,
      target_id: event.target?.id,
    });
  }
}
