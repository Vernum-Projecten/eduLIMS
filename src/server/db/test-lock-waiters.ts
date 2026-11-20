// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The wait of the forced-order race tests (#318, #345): a test holds a row by hand, starts the
// operations one by one and waits here until each of them queues on a lock.
import type { CommittedTestDb } from "./test-committed-db.ts";

const WAIT_LIMIT_MS = 10_000;

/** Waits until `count` backends of this database wait on a lock; throws after 10 seconds. */
export async function lockWaiters(database: CommittedTestDb, count: number): Promise<void> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const { rows } = await database.pool.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`fewer than ${count} lock waiters`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Holds the row of the user `userId` (`FOR UPDATE`), starts `first` and waits until it queues,
 * then the same for `second`, and releases the row; returns both outcomes.
 */
export async function inUserOrder<A, B>(
  database: CommittedTestDb,
  userId: string,
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[A, B]> {
  const holder = await database.pool.connect();
  try {
    await holder.query("begin");
    await holder.query(`select id from "user" where id = $1 for update`, [userId]);
    const one = first();
    await lockWaiters(database, 1);
    const two = second();
    await lockWaiters(database, 2);
    await holder.query("commit");
    return await Promise.all([one, two]);
  } finally {
    holder.release();
  }
}
