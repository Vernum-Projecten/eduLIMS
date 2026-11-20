// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A start that meets a change of who may start it, or of what it needs, on a committed database
// (security review of #403, S1 and N2). A pool client holds the lock the other writer would take,
// the start queues behind it in `pg_stat_activity`, and the client then commits its change: a
// co-teacher removed while their start waited reads `not_found`, and a start that waited on the
// deletion of its only student is refused `no_students`. These need committing transactions.
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { startSimulation } from "./state.ts";
import { NOW, notFoundLine, securityLines, startable, world } from "./test-helpers.ts";

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

/** Waits until a backend of this database waits on a lock. */
async function lockWaiter(): Promise<void> {
  const { db } = database();
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'`.execute(db);
    if ((rows[0]?.n ?? 0) >= 1) return;
    if (Date.now() > deadline) throw new Error("no lock waiter");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A statement and its parameters. */
type Statement = [text: string, params: unknown[]];

/** Holds `lock` on a pool client, runs `start` behind it, then commits `change` and returns. */
async function behind<T>(lock: Statement, change: Statement, start: () => Promise<T>) {
  const client = await database().pool.connect();
  try {
    await client.query("begin");
    await client.query(...lock);
    const started = start();
    await lockWaiter();
    await client.query(...change);
    await client.query("commit");
    return await started;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function stateOf(simulationId: string): Promise<string | undefined> {
  const row = await database()
    .db.selectFrom("simulations")
    .select("state")
    .where("id", "=", simulationId)
    .executeTakeFirst();
  return row?.state;
}

describe("a start that waits on a change (security review of #403)", () => {
  it("is not_found for a co-teacher removed while the start waited (S1)", async () => {
    const { db } = database();
    const w = await world(db);
    await startable(db, w.simulationId);
    let result: unknown;
    const lines = await securityLines(async () => {
      // The removal of a teacher holds the simulation row, as `removeTeacher` does.
      result = await behind(
        ["select id from simulations where id = $1 for update", [w.simulationId]],
        [
          "delete from simulation_teachers where simulation_id = $1 and user_id = $2",
          [w.simulationId, w.coTeacher.id],
        ],
        () => startSimulation(db, w.coTeacher, { simulationId: w.simulationId }, NOW),
      );
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(lines).toEqual([notFoundLine(w.coTeacher.id, "simulation", w.simulationId)]);
    expect(await stateOf(w.simulationId)).toBe("prepared");
  });

  it("is refused no_students when its only student's account went while it waited (N2)", async () => {
    const { db } = database();
    const w = await world(db);
    await startable(db, w.outsideSimulationId);
    // An account deletion locks the student's places first, as `deleteUser` does.
    const result = await behind(
      [
        "select simulation_id from lab_members where user_id = $1 for update",
        [w.outsideStudent.id],
      ],
      [`delete from "user" where id = $1`, [w.outsideStudent.id]],
      () => startSimulation(db, w.outsiderTeacher, { simulationId: w.outsideSimulationId }, NOW),
    );
    expect(result).toEqual({ ok: false, error: "no_students" });
    expect(await stateOf(w.outsideSimulationId)).toBe("prepared");
  });
});
