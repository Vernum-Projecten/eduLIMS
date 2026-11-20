// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A link and a removal of the same student that meet on the simulation lock (S10, R-01, #330).
// A pool client holds the simulation row; the test starts the two writers one after the other,
// waiting in `pg_stat_activity` until each queues behind the lock, so the order is fixed. In either
// order the student ends outside every lab with the removal record kept, and the next link puts
// nobody back; two links of a removed student log one refusal. These need committing transactions.
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { linkWaitingAddresses } from "./linking.ts";
import { removeMember } from "./members.ts";
import { auditRows, NOW } from "./test-helpers.ts";
import { labOf } from "./test-join.ts";
import {
  removals,
  removalWorld,
  removedWhileWaiting,
  verify,
  wait,
  waiting,
} from "./test-removal.ts";

let committed: CommittedTestDb | undefined;

beforeEach(async () => {
  committed = await createCommittedTestDb(12);
}, 60_000);

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
}, 60_000);

function database(): CommittedTestDb {
  if (!committed) throw new Error("no committed test database");
  return committed;
}

const WAIT_MS = 10_000;

/** Waits until `count` backends of this database wait on a lock. */
async function lockWaiters(count: number): Promise<void> {
  const { db } = database();
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`.execute(db);
    if ((rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`fewer than ${count} lock waiters`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Holds the simulation row, starts `first` and `second` in that order behind it, and releases
 * it. Returns what each resolved to.
 */
async function inOrder<A, B>(
  simulationId: string,
  first: () => Promise<A>,
  second: () => Promise<B>,
) {
  const { pool } = database();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from simulations where id = $1 for update", [simulationId]);
    const a = first();
    await lockWaiters(1);
    const b = second();
    await lockWaiters(2);
    await client.query("commit");
    return { first: await a, second: await b };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** A verified student in lab A whose address also waits in lab B. */
async function memberWithWaitingAddress() {
  const opened = await removalWorld(database().db);
  const { database: db, w } = opened;
  await wait(db, w.simulationId, w.otherLabId, w.student.email);
  const link = () => linkWaitingAddresses(db, w.student.id, NOW);
  const remove = () =>
    removeMember(db, w.teacher, { simulationId: w.simulationId, userId: w.student.id }, NOW);
  return { ...opened, link, remove };
}

async function refusals() {
  const rows = await auditRows(database().db, "lab_member_joined");
  return rows.filter((row) => row.outcome === "refused").map((row) => row.reason_code);
}

async function expectOutsideForGood(opened: Awaited<ReturnType<typeof memberWithWaitingAddress>>) {
  const { database: db, w } = opened;
  expect(await labOf(db, w.simulationId, w.student.id)).toBeNull();
  expect(await removals(db, w.simulationId)).toEqual([{ user_id: w.student.id }]);
  expect(await waiting(db, w.student.email)).toEqual([]);
  expect(await linkWaitingAddresses(db, w.student.id, NOW)).toEqual({
    linked: 0,
    refused: 0,
    failed: 0,
  });
}

describe("a link and a removal on the simulation lock (#330)", () => {
  it("link first: the link refuses the address once, the removal then drops nothing", async () => {
    const opened = await memberWithWaitingAddress();
    const result = await inOrder(opened.w.simulationId, opened.link, opened.remove);
    expect(result.first).toEqual({ linked: 0, refused: 1, failed: 0 });
    expect(result.second).toEqual({ ok: true, value: null });
    expect(await refusals()).toEqual(["in_other_lab"]);
    const removed = await auditRows(opened.database, "lab_member_removed");
    expect(removed.map((row) => row.metadata)).toEqual([expect.objectContaining({ count: 0 })]);
    await expectOutsideForGood(opened);
  });

  it("removal first: the removal drops the address, and the waiting link finds none", async () => {
    const opened = await memberWithWaitingAddress();
    const result = await inOrder(opened.w.simulationId, opened.remove, opened.link);
    expect(result.first).toEqual({ ok: true, value: null });
    expect(result.second).toEqual({ linked: 0, refused: 0, failed: 0 });
    expect(await refusals()).toEqual([]);
    const removed = await auditRows(opened.database, "lab_member_removed");
    expect(removed.map((row) => row.metadata)).toEqual([expect.objectContaining({ count: 1 })]);
    await expectOutsideForGood(opened);
  });

  it("two links of a removed student behind the lock write one removed row", async () => {
    const opened = await removalWorld(database().db);
    const { database: db, w } = opened;
    const student = await removedWhileWaiting(opened, "late-verified");
    await verify(db, student.id);
    const link = () => linkWaitingAddresses(db, student.id, NOW);
    const result = await inOrder(w.simulationId, link, link);
    expect(result).toEqual({
      first: { linked: 0, refused: 1, failed: 0 },
      second: { linked: 0, refused: 1, failed: 0 },
    });
    expect(await refusals()).toEqual(["removed"]);
    expect(await labOf(db, w.simulationId, student.id)).toBeNull();
    expect(await removals(db, w.simulationId)).toEqual([{ user_id: student.id }]);
  });
});
