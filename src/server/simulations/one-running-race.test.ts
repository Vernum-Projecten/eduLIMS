// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One running simulation at a time under concurrency (D11, owner 2026-11-20, #386): two starts at
// once, and a start that meets another start held open by hand. These need real, committing
// transactions; the forced-order cases hold the first start open so the second waits on the
// index of migration 0030 and is then refused, logged, with its simulation left prepared.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CommittedTestDb, createCommittedTestDb } from "../db/test-committed-db.ts";
import { startSimulation } from "./state.ts";
import { auditRows, NOW, world } from "./test-helpers.ts";

let committed: CommittedTestDb | undefined;

beforeEach(async () => {
  committed = await createCommittedTestDb(8);
}, 60_000);

afterEach(async () => {
  await committed?.destroy();
  committed = undefined;
}, 60_000);

function database(): CommittedTestDb {
  if (!committed) throw new Error("no committed test database");
  return committed;
}

/** Resolves to whether `promise` settles within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), ms));
  return Promise.race([promise.then(() => true), timeout]);
}

async function runningIds(): Promise<string[]> {
  const rows = await database()
    .db.selectFrom("simulations")
    .select("id")
    .where("state", "=", "running")
    .execute();
  return rows.map((row) => row.id);
}

describe("two starts at once (#386)", () => {
  it("leaves one simulation running when both run in parallel", async () => {
    const { db } = database();
    const w = await world(db);
    const results = await Promise.all([
      startSimulation(db, w.teacher, { simulationId: w.simulationId }, NOW),
      startSimulation(db, w.outsiderTeacher, { simulationId: w.outsideSimulationId }, NOW),
    ]);
    expect(await runningIds()).toHaveLength(1);
    const outcomes = results.map((result) => (result.ok ? "started" : result.error));
    expect(outcomes.sort()).toEqual(["another_running", "started"]);
  });

  it("makes the second start wait for the first and then refuses it (forced order)", async () => {
    const { db, pool } = database();
    const w = await world(db);
    const client = await pool.connect();
    try {
      // The first start, held open after it set its simulation running.
      await client.query("begin");
      await client.query(
        "update simulations set state = 'running', started_at = now() where id = $1",
        [w.outsideSimulationId],
      );
      const second = startSimulation(db, w.teacher, { simulationId: w.simulationId }, NOW);
      expect(await settlesWithin(second, 300)).toBe(false);
      await client.query("commit");
      expect(await second).toEqual({ ok: false, error: "another_running" });
    } finally {
      client.release();
    }
    expect(await runningIds()).toEqual([w.outsideSimulationId]);
    expect(await auditRows(db, "simulation_started")).toEqual([
      expect.objectContaining({
        outcome: "refused",
        reason_code: "another_running",
        target_id: w.simulationId,
      }),
    ]);
  });

  it("lets the second start run when the first rolls back (forced order)", async () => {
    const { db, pool } = database();
    const w = await world(db);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "update simulations set state = 'running', started_at = now() where id = $1",
        [w.outsideSimulationId],
      );
      const second = startSimulation(db, w.teacher, { simulationId: w.simulationId }, NOW);
      expect(await settlesWithin(second, 300)).toBe(false);
      await client.query("rollback");
      expect(await second).toEqual({ ok: true, value: null });
    } finally {
      client.release();
    }
    expect(await runningIds()).toEqual([w.simulationId]);
  });
});
