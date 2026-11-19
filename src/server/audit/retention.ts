// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The retention periods of the owner decisions on #32 (2026-11-11) and #300 (2026-11-19): the
// activity log keeps 12 months, ended sessions are deleted after 30 days, and an address that
// waits on a lab's list is deleted 90 days after it was added if no student linked it.
// Relative imports: `pnpm db:prune` loads this in plain Node.
import { type Kysely, sql } from "kysely";
import type { DB } from "../db/schema.gen.ts";

/** How long the activity log keeps an event (B4; owner decision on #32). */
export const AUDIT_RETENTION_MONTHS = 12;

/** How long an expired session row stays before it is deleted (owner decision on #32). */
export const ENDED_SESSION_RETENTION_DAYS = 30;

/**
 * How long an address waits on a lab's list before it is deleted unlinked (owner decision,
 * 2026-11-19, #300, ASVS V14.2.4). A linked address is deleted at the link already.
 */
export const WAITING_ADDRESS_RETENTION_DAYS = 90;

/** What one prune removed. */
export interface PruneResult {
  auditEvents: number;
  sessions: number;
  /** Waiting lab addresses: a count only, never an address. */
  waitingAddresses: number;
}

/**
 * Deletes activity-log events older than {@link AUDIT_RETENTION_MONTHS} months, sessions that
 * expired more than {@link ENDED_SESSION_RETENTION_DAYS} days before `now`, and addresses that
 * have waited on a lab's list for more than {@link WAITING_ADDRESS_RETENTION_DAYS} days, in one
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
  // NOTE: #311; rows are locked in key order and a row a teacher's write holds is skipped until
  // the next run, so the prune never waits on, or deadlocks with, a simulation's delete.
  const waiting = await db
    .deleteFrom("lab_member_emails")
    .where(({ eb, refTuple, selectFrom }) =>
      eb(
        refTuple("simulation_id", "email"),
        "in",
        selectFrom("lab_member_emails")
          .select(["simulation_id", "email"])
          .where(
            "added_at",
            "<",
            sql<Date>`${now}::timestamptz - make_interval(days => ${WAITING_ADDRESS_RETENTION_DAYS})`,
          )
          .orderBy(["simulation_id", "email"])
          .forUpdate()
          .skipLocked()
          .$asTuple("simulation_id", "email"),
      ),
    )
    .executeTakeFirst();
  // NOTE: #49; the join-code counters only matter within their 15-minute window, so a day-old
  // row is dropped here and not counted: it is neither an event nor a person's record.
  await db
    .deleteFrom("lab_join_attempts")
    .where("window_start", "<", sql<Date>`${now}::timestamptz - make_interval(days => 1)`)
    .execute();
  return {
    auditEvents: Number(events.numDeletedRows),
    sessions: Number(sessions.numDeletedRows),
    waitingAddresses: Number(waiting.numDeletedRows),
  };
}
