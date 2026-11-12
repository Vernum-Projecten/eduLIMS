// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The brute-force limit of joining with a code (#49; ASVS V2.4.1, V6.3.1): every attempt is
// charged against the student and the client IP in PostgreSQL before the code is looked up, in
// one atomic upsert per key, and a join refunds it. Parallel requests, restarts and replicas all
// see the same count, and no table in memory can fill up and refuse a fresh student.
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import { JOIN_LIMIT_WINDOW_MINUTES } from "../../lib/join-code.ts";
import type { DB } from "../db/schema.gen.ts";

/** The wrong codes one key may send per window; the next attempt is over the limit. */
export interface JoinLimits {
  user: number;
  ip: number;
  windowMs: number;
}

// NOTE: no requirement governs these numbers: our own design, flagged on #49 for the owner.
export const JOIN_LIMITS: JoinLimits = {
  user: 10,
  ip: 50,
  windowMs: JOIN_LIMIT_WINDOW_MINUTES * 60_000,
};

/** The key of a student or of a client IP. */
export type LimitKey = { kind: "user"; id: string } | { kind: "ip"; address: string };

/** Returns the text of a key, which is stored only as its keyed hash (no address at rest). */
export function limitKeyText(key: LimitKey): string {
  return key.kind === "user" ? `user:${key.id}` : `ip:${key.address}`;
}

/** The count of one key after an attempt was charged. */
export interface Charge {
  key: LimitKey;
  keyHash: string;
  attempts: number;
}

/**
 * Charges one attempt to the key whose hash is `keyHash` and returns its count in the current
 * window: 1 for a new key or a window that has passed. One statement, so parallel attempts never
 * read the same count.
 */
export async function chargeAttempt(
  db: Kysely<DB>,
  keyHash: string,
  now: Date,
  windowMs: number,
): Promise<number> {
  const cutoff = new Date(now.getTime() - windowMs);
  const row = await db
    .insertInto("class_join_attempts")
    .values({ key_hash: keyHash, window_start: now, failures: 1 })
    .onConflict((conflict) =>
      conflict.column("key_hash").doUpdateSet({
        failures: sql`case when class_join_attempts.window_start <= ${cutoff} then 1 else class_join_attempts.failures + 1 end`,
        window_start: sql`case when class_join_attempts.window_start <= ${cutoff} then ${now}::timestamptz else class_join_attempts.window_start end`,
      }),
    )
    .returning("failures")
    .executeTakeFirstOrThrow();
  return row.failures;
}

/** Takes back the attempt a join charged, within the same window. */
export async function refundAttempt(
  db: Kysely<DB>,
  keyHash: string,
  now: Date,
  windowMs: number,
): Promise<void> {
  await db
    .updateTable("class_join_attempts")
    .set({ failures: sql`greatest(failures - 1, 0)` })
    .where("key_hash", "=", keyHash)
    .where("window_start", ">", new Date(now.getTime() - windowMs))
    .execute();
}

/** Returns whether a charged key is over its limit. */
export function overLimit(charge: Charge, limits: JoinLimits): boolean {
  return charge.attempts > (charge.key.kind === "user" ? limits.user : limits.ip);
}

/** Returns whether this charge is the one that went over the limit, which is logged once. */
export function justOverLimit(charge: Charge, limits: JoinLimits): boolean {
  return charge.attempts === (charge.key.kind === "user" ? limits.user : limits.ip) + 1;
}
