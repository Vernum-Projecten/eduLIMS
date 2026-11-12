// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One retention prune (B4; owner decision on #32), shared by the schedule inside the app
// container (src/server/plugins/retention-prune.ts) and the host CLI's `prune`
// (src/server/db/prune.ts). Relative imports: the CLI loads this in plain Node.
import { type Kysely, sql } from "kysely";
import { pruneExpiredGrants } from "../admin-grant/grants.ts";
import { RETENTION_PRUNE_LOCK_KEY } from "../db/advisory-locks.ts";
import type { DB } from "../db/schema.gen.ts";
import { logFailure } from "../security-log.ts";
import { recordAudit, recordCommittedAudit } from "./record.ts";
import { deleteExpired } from "./retention.ts";

/** How many rows one prune removed, per kind. */
export interface PruneCounts {
  auditEvents: number;
  sessions: number;
  invitations: number;
  adminGrants: number;
}

/** What one prune did: it removed rows, or another runner held the lock and it skipped. */
export type PruneOutcome = { kind: "pruned"; counts: PruneCounts } | { kind: "locked" };

/**
 * Applies the retention periods and drops expired pending admin grants in one transaction that
 * holds {@link RETENTION_PRUNE_LOCK_KEY}, and writes a `sys_retention_prune` activity-log row with the
 * counts in the same transaction. When another runner (a second replica, an operator's `prune`)
 * holds the lock, it removes nothing and returns `locked`.
 *
 * @throws the database error when a delete or the log row fails; the transaction rolls back.
 */
export async function runPrune(db: Kysely<DB>, now: Date): Promise<PruneOutcome> {
  return db.transaction().execute(async (trx) => {
    const lock = await sql<{
      locked: boolean;
    }>`select pg_try_advisory_xact_lock(${RETENTION_PRUNE_LOCK_KEY}) as locked`.execute(trx);
    if (lock.rows[0]?.locked !== true) return { kind: "locked" };
    const { auditEvents, sessions, invitations } = await deleteExpired(trx, now);
    const adminGrants = await pruneExpiredGrants(trx, now);
    await recordAudit(trx, {
      action: "sys_retention_prune",
      actor: { type: "system" },
      outcome: "success",
      metadata: {
        removed_audit_events: auditEvents,
        removed_sessions: sessions,
        removed_invitations: invitations,
        removed_admin_grants: adminGrants,
      },
    });
    return { kind: "pruned", counts: { auditEvents, sessions, invitations, adminGrants } };
  });
}

/** The security-log event of a prune that failed. */
export const PRUNE_FAILED_EVENT = "retention_prune_failed";

/**
 * Records a failed prune: a `retention_prune_failed` line on the security stream with its cause
 * chain ({@link logFailure}), and a best-effort `sys_retention_prune` row with outcome `failure`
 * (a database that is down takes no row, and {@link recordCommittedAudit} logs that too). Never
 * throws.
 */
export async function recordPruneFailure(db: Kysely<DB>, error: unknown): Promise<void> {
  logFailure(PRUNE_FAILED_EVENT, error, { actor_type: "system" });
  await recordCommittedAudit(db, {
    action: "sys_retention_prune",
    actor: { type: "system" },
    outcome: "failure",
    reason: "prune_failed",
  });
}

/**
 * Runs one scheduled prune: {@link runPrune}, and on failure {@link recordPruneFailure}, so the
 * schedule goes on and tries again at its next interval. Never throws.
 */
export async function runScheduledPrune(
  db: Kysely<DB>,
  now: Date,
): Promise<PruneOutcome | { kind: "failed" }> {
  try {
    return await runPrune(db, now);
  } catch (error) {
    await recordPruneFailure(db, error);
    return { kind: "failed" };
  }
}
