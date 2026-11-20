// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Starting a simulation against a catalogue edit on a committed database (D9, D10; the security
// note on #268): the start locks the tests its correct values name `FOR SHARE`, so an edit that a
// running simulation forbids waits for the start to commit and is then refused, never slipped in
// while the simulation reads as prepared.
import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { updateTest } from "../catalogue/actions.ts";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { startSimulation } from "../simulations/state.ts";
import { NOW, world } from "../simulations/test-helpers.ts";
import { seedSecrets } from "./test-helpers.ts";

let committed: CommittedTestDb | undefined;
let holder: PoolClient | undefined;

afterEach(async () => {
  await holder?.query("rollback").catch(() => undefined);
  holder?.release();
  holder = undefined;
  await committed?.destroy();
  committed = undefined;
});

const WAIT_MS = 10_000;

/** Waits until `count` backends of this database wait on a lock. */
async function waitForLockWaiters(pool: Pool, count: number): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (Number(rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`fewer than ${count} lock waiters`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("a start and a catalogue edit at once (D9, #267)", () => {
  it("makes the edit wait for the start and then refuses it", async () => {
    committed = await createCommittedTestDb(6);
    const { db, pool } = committed;
    const w = await world(db);
    const testId = await seedSecrets(db, w);
    // Hold the start inside its transaction after it locked the tests: the activity log takes no
    // insert while this connection holds it in SHARE mode.
    holder = await pool.connect();
    await holder.query("begin");
    await holder.query("lock table audit_event in share mode");
    const start = startSimulation(db, w.teacher, { simulationId: w.simulationId }, NOW);
    await waitForLockWaiters(pool, 1);
    const edit = updateTest(
      { db, actor: w.coTeacher, now: NOW },
      {
        testId,
        test: {
          name: "Glucose (invented)",
          unit: "mmol/L",
          material: "serum",
          source: { kind: "manual" },
        },
      },
    );
    await waitForLockWaiters(pool, 2);
    await holder.query("commit");
    holder.release();
    holder = undefined;
    expect(await start).toEqual({ ok: true, value: null });
    expect(await edit).toEqual({ ok: false, error: "in_running_simulation" });
    const stored = await db
      .selectFrom("catalogue_tests")
      .select("material")
      .where("id", "=", testId)
      .executeTakeFirstOrThrow();
    expect(stored.material).toBe("plasma");
  });
});
