// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The row side of a result write to FerroEHR (#148, #382): which writes are due, the lease one
// attempt takes on its row just before it talks to FerroEHR, and the outcome it records under
// that lease. A run whose lease ran out and was taken over records nothing, so an overlap never
// counts an attempt twice or overwrites the outcome of the run that holds the row.
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import type { MeasurementId } from "../../lib/results.ts";
import type { DB } from "../db/schema.gen.ts";

// NOTE: no openEHR spec governs these: our own design (#148, #382). An attempt holds its row for
// 5 minutes; the n-th failure pauses 2^(n-1) minutes, at most 60, whatever the error.
export const LEASE_MINUTES = 5;
export const MAX_PAUSE_MINUTES = 60;
/** The smallest exponent whose power of two reaches {@link MAX_PAUSE_MINUTES}. */
const MAX_PAUSE_EXPONENT = Math.ceil(Math.log2(MAX_PAUSE_MINUTES));

/** The lease one attempt holds on a pending write. */
export type ResultWriteLease = string & { readonly __brand: "ResultWriteLease" };

/** How a failure was recorded: with a new error code, with the same code, or not (lease lost). */
export type FailureRecord = "changed" | "same" | "lost";

/**
 * Returns the ids of up to `limit` pending writes whose pause is over, oldest due first. Nothing
 * is leased here: each attempt takes its own row with {@link takeLease}.
 */
export async function dueWrites(db: Kysely<DB>, limit: number): Promise<string[]> {
  const rows = await db
    .selectFrom("result_ehr_writes")
    .select("measurement_id")
    .where("state", "=", "pending")
    .where("next_attempt_at", "<=", sql<Date>`now()`)
    .orderBy("next_attempt_at")
    .orderBy("measurement_id")
    .limit(limit)
    .execute();
  return rows.map((row) => row.measurement_id);
}

/**
 * Leases the pending write of `measurementId` for {@link LEASE_MINUTES} and returns the lease, or
 * `null` when the row is written, gone, or (with `due`) not due, which includes a row another
 * attempt holds. Without `due` it takes the row whatever its pause: the write right after a
 * release.
 */
export async function takeLease(
  db: Kysely<DB>,
  measurementId: MeasurementId,
  options: { due: boolean },
): Promise<ResultWriteLease | null> {
  const due = options.due ? sql`and next_attempt_at <= now()` : sql``;
  const taken = await sql<{ lease_id: string }>`
    update result_ehr_writes
    set lease_id = uuidv7(), next_attempt_at = now() + make_interval(mins => ${LEASE_MINUTES})
    where measurement_id = ${measurementId} and state = 'pending' ${due}
    returning lease_id::text as lease_id`.execute(db);
  const leaseId = taken.rows[0]?.lease_id;
  // A uuid PostgreSQL just generated for this row.
  return leaseId === undefined ? null : (leaseId as ResultWriteLease);
}

/**
 * Records a failed attempt under `lease`: one more attempt, the error code, and the pause before
 * the next one, clamped before it is multiplied so no count of attempts overflows the interval.
 */
export async function recordFailure(
  db: Kysely<DB>,
  measurementId: MeasurementId,
  lease: ResultWriteLease,
  code: string,
): Promise<FailureRecord> {
  const recorded = await sql<{ previous: string | null }>`
    update result_ehr_writes
    set attempts = attempts + 1,
        last_error = ${code},
        lease_id = null,
        next_attempt_at = now() + make_interval(mins => least(
          power(2, least(attempts, ${MAX_PAUSE_EXPONENT}))::integer, ${MAX_PAUSE_MINUTES}))
    where measurement_id = ${measurementId} and state = 'pending' and lease_id = ${lease}
    returning old.last_error as previous`.execute(db);
  const row = recorded.rows[0];
  if (row === undefined) return "lost";
  return row.previous === code ? "same" : "changed";
}

/** Marks the write written under `lease`; returns `false` when the lease was lost. */
export async function recordWritten(
  db: Kysely<DB>,
  measurementId: MeasurementId,
  lease: ResultWriteLease,
  versionUid: string,
): Promise<boolean> {
  const updated = await db
    .updateTable("result_ehr_writes")
    .set({
      state: "written",
      version_uid: versionUid,
      written_at: sql`now()`,
      last_error: null,
      lease_id: null,
    })
    .where("measurement_id", "=", measurementId)
    .where("state", "=", "pending")
    .where("lease_id", "=", lease)
    .executeTakeFirst();
  return updated.numUpdatedRows > 0n;
}

/** Returns the state of the write of `measurementId`, or `undefined` when it has no row. */
export async function writeState(
  db: Kysely<DB>,
  measurementId: MeasurementId,
): Promise<string | undefined> {
  const row = await db
    .selectFrom("result_ehr_writes")
    .select("state")
    .where("measurement_id", "=", measurementId)
    .executeTakeFirst();
  return row?.state;
}
