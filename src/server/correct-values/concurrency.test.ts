// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Races on a committed database (D9, D10; the security note on #268 and the review of #341): a
// start against a catalogue edit, a student's write against a finish, and a first correct value
// against a retirement. Each lock makes the later transaction wait, then see the committed state.
import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { retireTest, updateTest } from "../catalogue/actions.ts";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { finishSimulation, startSimulation } from "../simulations/state.ts";
import { findWorkingStudentLab } from "../simulations/student-access.ts";
import { NOW, world } from "../simulations/test-helpers.ts";
import { setCorrectValues } from "./actions.ts";
import { catalogueTest, seedSecrets } from "./test-helpers.ts";

const LATER = new Date("2026-11-19T12:00:00Z");

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

/** A promise and the function that settles it, for holding a transaction open in a test. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe("a student's write and a finish at once (D10, #341 review S2)", () => {
  it("makes the finish wait while the student's transaction holds the running check", async () => {
    committed = await createCommittedTestDb(6);
    const { db, pool } = committed;
    const w = await world(db);
    await seedSecrets(db, w);
    await startSimulation(db, w.teacher, { simulationId: w.simulationId }, NOW);
    const checked = gate();
    const release = gate();
    const student = db.transaction().execute(async (trx) => {
      const lab = await findWorkingStudentLab(trx, w.student.id, w.labId);
      checked.open();
      await release.opened;
      // The stub of the lab's work: a write inside the same transaction.
      if (lab) {
        await trx
          .updateTable("labs")
          .set({ updated_at: LATER })
          .where("id", "=", lab.labId)
          .execute();
      }
      return lab;
    });
    await checked.opened;
    let finishedFirst = false;
    const finish = finishSimulation(db, w.teacher, { simulationId: w.simulationId }, LATER).then(
      (result) => {
        finishedFirst = true;
        return result;
      },
    );
    await waitForLockWaiters(pool, 1);
    expect(finishedFirst).toBe(false);
    release.open();
    expect(await student).toEqual({ labId: w.labId, simulationId: w.simulationId });
    expect(await finish).toEqual({ ok: true, value: null });
    const state = await db
      .selectFrom("simulations")
      .select("state")
      .where("id", "=", w.simulationId)
      .executeTakeFirstOrThrow();
    expect(state.state).toBe("finished");
  });
});

describe("a first value and a retirement at once (D9, #341 review S4)", () => {
  it("makes the value wait for the retirement and then refuses it", async () => {
    committed = await createCommittedTestDb(6);
    const { db, pool } = committed;
    const w = await world(db);
    const testId = await catalogueTest(db, "Retiring test (invented)");
    // Hold the retirement after it locked the test: the activity log takes no insert meanwhile.
    holder = await pool.connect();
    await holder.query("begin");
    await holder.query("lock table audit_event in share mode");
    const retire = retireTest({ db, actor: w.coTeacher, now: NOW }, { testId });
    await waitForLockWaiters(pool, 1);
    const value = setCorrectValues(
      db,
      w.teacher,
      { simulationId: w.simulationId, rows: [{ sampleNumber: "S-1", testId, value: "1" }] },
      NOW,
    );
    await waitForLockWaiters(pool, 2);
    await holder.query("commit");
    holder.release();
    holder = undefined;
    expect(await retire).toEqual({ ok: true, testId });
    expect(await value).toEqual({ ok: false, error: "test_retired" });
    expect(await db.selectFrom("correct_values").select("id").execute()).toEqual([]);
  });
});
