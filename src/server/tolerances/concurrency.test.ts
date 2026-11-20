// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Races on a committed database (S10, S13; the security review of #352, S1): a tolerance set
// against a teacher's removal or move of the student, a finish and a retirement. In each, the
// other transaction holds its lock (the activity log takes no insert while a pool client holds it
// in SHARE mode), the set waits on a lock, and after the commit it sees the committed state.
import type { Kysely } from "kysely";
import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { retireTest } from "../catalogue/actions.ts";
import { asAdmin } from "../catalogue/test-helpers.ts";
import type { DB } from "../db/schema.gen.ts";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import type { SimulationResult } from "../simulations/access.ts";
import { moveMember, removeMember } from "../simulations/members.ts";
import { finishSimulation } from "../simulations/state.ts";
import { NOW, type World } from "../simulations/test-helpers.ts";
import { setTolerance } from "./actions.ts";
import { runningWorld } from "./test-helpers.ts";

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

/**
 * Runs `other` while a pool client holds the activity log, so `other` keeps its row locks open;
 * then a tolerance set by the world's first student, which must wait; then commits the holder.
 * Returns both outcomes and the lab's stored tolerances.
 */
async function race(
  other: (db: Kysely<DB>, w: World, testId: string) => Promise<unknown>,
): Promise<{ other: unknown; set: SimulationResult<unknown>; rows: number }> {
  committed = await createCommittedTestDb(6);
  const { db, pool } = committed;
  const { w, testId } = await runningWorld(db);
  holder = await pool.connect();
  await holder.query("begin");
  await holder.query("lock table audit_event in share mode");
  const first = other(db, w, testId);
  await waitForLockWaiters(pool, 1);
  const set = setTolerance(db, w.student, { labId: w.labId, testId, lower: "1", upper: "2" });
  await waitForLockWaiters(pool, 2);
  await holder.query("commit");
  holder.release();
  holder = undefined;
  const results = { other: await first, set: await set };
  const rows = await db.selectFrom("lab_tolerances").select("id").execute();
  return { ...results, rows: rows.length };
}

describe("a tolerance set against a change of membership (review of #352, S1)", () => {
  it("lands nowhere when the teacher removes the student meanwhile", async () => {
    const outcome = await race((db, w) =>
      removeMember(db, w.teacher, { simulationId: w.simulationId, userId: w.student.id }, NOW),
    );
    expect(outcome).toEqual({
      other: { ok: true, value: null },
      set: { ok: false, error: "not_found" },
      rows: 0,
    });
  });

  it("lands nowhere when the teacher moves the student to another lab meanwhile", async () => {
    const outcome = await race((db, w) =>
      moveMember(db, w.teacher, {
        simulationId: w.simulationId,
        userId: w.student.id,
        labId: w.otherLabId,
      }),
    );
    expect(outcome).toEqual({
      other: { ok: true, value: null },
      set: { ok: false, error: "not_found" },
      rows: 0,
    });
  });
});

describe("a tolerance set against a finish and a retirement", () => {
  it("is refused with not_running when the simulation finishes meanwhile", async () => {
    const outcome = await race((db, w) =>
      finishSimulation(db, w.teacher, { simulationId: w.simulationId }, NOW),
    );
    expect(outcome).toEqual({
      other: { ok: true, value: null },
      set: { ok: false, error: "not_running" },
      rows: 0,
    });
  });

  it("is refused with test_retired when its test is retired meanwhile (D9)", async () => {
    const outcome = await race((db, w, testId) =>
      retireTest({ db: db, actor: asAdmin(w.coTeacher), now: NOW }, { testId }),
    );
    expect(outcome.set).toEqual({ ok: false, error: "test_retired" });
    expect(outcome.rows).toBe(0);
  });
});
