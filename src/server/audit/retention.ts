// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The retention periods of the owner decisions on #32 and #28 (2026-11-11): the activity log keeps
// 12 months, ended sessions are deleted after 30 days, and ended class invitations after 90.
// Relative imports: `pnpm db:prune` loads this in plain Node.
import { type Kysely, sql } from "kysely";
import type { DB } from "../db/schema.gen.ts";

/** How long the activity log keeps an event (B4; owner decision on #32). */
export const AUDIT_RETENTION_MONTHS = 12;

/** How long an expired session row stays before it is deleted (owner decision on #32). */
export const ENDED_SESSION_RETENTION_DAYS = 30;

/** How long an ended class invitation stays before it is deleted (owner decision on #28 (4)). */
export const ENDED_INVITATION_RETENTION_DAYS = 90;

/** What one prune removed. */
export interface PruneResult {
  auditEvents: number;
  sessions: number;
  invitations: number;
}

/**
 * Deletes activity-log events older than {@link AUDIT_RETENTION_MONTHS} months, sessions that
 * expired more than {@link ENDED_SESSION_RETENTION_DAYS} days before `now`, and class invitations
 * that ended or expired more than {@link ENDED_INVITATION_RETENTION_DAYS} days before `now`, in one
 * transaction. A second run with the same clock removes nothing.
 */
export async function pruneRetention(db: Kysely<DB>, now: Date): Promise<PruneResult> {
  return db.transaction().execute((trx) => deleteExpired(trx, now));
}

/**
 * Runs the deletes of {@link pruneRetention} on `db` as it is, so a caller that already holds a
 * transaction (the scheduled prune, which also takes its lock there) commits them with its own
 * writes.
 */
export async function deleteExpired(db: Kysely<DB>, now: Date): Promise<PruneResult> {
  const events = await db
    .deleteFrom("audit_event")
    .where(
      "occurred_at",
      "<",
      sql<Date>`${now}::timestamptz - make_interval(months => ${AUDIT_RETENTION_MONTHS})`,
    )
    .executeTakeFirst();
  const sessions = await db
    .deleteFrom("session")
    .where(
      "expiresAt",
      "<",
      sql<Date>`${now}::timestamptz - make_interval(days => ${ENDED_SESSION_RETENTION_DAYS})`,
    )
    .executeTakeFirst();
  // An invitation ends when it is accepted, rejected or canceled (`ended_at`), or expires.
  const cutoff = sql<Date>`${now}::timestamptz - make_interval(days => ${ENDED_INVITATION_RETENTION_DAYS})`;
  const invitations = await db
    .deleteFrom("invitation")
    .where((eb) =>
      eb.or([
        eb.and([eb("status", "<>", "pending"), eb("ended_at", "<", cutoff)]),
        eb.and([eb("status", "=", "pending"), eb("expiresAt", "<", cutoff)]),
      ]),
    )
    .executeTakeFirst();
  return {
    auditEvents: Number(events.numDeletedRows),
    sessions: Number(sessions.numDeletedRows),
    invitations: Number(invitations.numDeletedRows),
  };
}
