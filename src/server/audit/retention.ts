// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The retention periods of the owner decision on #32 (2026-11-11): the activity log keeps 12
// months, and ended sessions are deleted after 30 days. Relative imports: `pnpm db:prune` loads
// this in plain Node.
import { type Kysely, sql } from "kysely";
import type { DB } from "../db/schema.gen.ts";

/** How long the activity log keeps an event (B4; owner decision on #32). */
export const AUDIT_RETENTION_MONTHS = 12;

/** How long an expired session row stays before it is deleted (owner decision on #32). */
export const ENDED_SESSION_RETENTION_DAYS = 30;

/** What one prune removed. */
export interface PruneResult {
  auditEvents: number;
  sessions: number;
}

/**
 * Deletes activity-log events older than {@link AUDIT_RETENTION_MONTHS} months and sessions that
 * expired more than {@link ENDED_SESSION_RETENTION_DAYS} days before `now`. A second run with
 * the same clock removes nothing.
 */
export async function pruneRetention(db: Kysely<DB>, now: Date): Promise<PruneResult> {
  return db.transaction().execute(async (trx) => {
    const events = await trx
      .deleteFrom("audit_event")
      .where(
        "occurred_at",
        "<",
        sql<Date>`${now}::timestamptz - make_interval(months => ${AUDIT_RETENTION_MONTHS})`,
      )
      .executeTakeFirst();
    const sessions = await trx
      .deleteFrom("session")
      .where(
        "expiresAt",
        "<",
        sql<Date>`${now}::timestamptz - make_interval(days => ${ENDED_SESSION_RETENTION_DAYS})`,
      )
      .executeTakeFirst();
    return {
      auditEvents: Number(events.numDeletedRows),
      sessions: Number(sessions.numDeletedRows),
    };
  });
}
