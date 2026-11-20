// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One running simulation at a time under concurrency (D11, owner 2026-11-20, #386): two starts at
// once, a start that meets another start held open by hand, and a start beside a finish that is
// not committed yet. These need real, committing transactions; the forced-order cases hold the
// first start open so the second waits on the index of migration 0030 and is then refused,
// logged, with its simulation left prepared.
import { describe, expect, it } from "vitest";
import { committedTestDbPerCase } from "../db/test-committed-hooks.ts";
import { settlesWithin } from "../db/test-lock-waiters.ts";
import { startSimulation } from "./state.ts";
import { auditRows, NOW, setState, type World, world } from "./test-helpers.ts";

const database = committedTestDbPerCase();

async function runningIds(): Promise<string[]> {
  const rows = await database()
    .db.selectFrom("simulations")
    .select("id")
    .where("state", "=", "running")
    .execute();
  return rows.map((row) => row.id);
}

/**
 * Holds a first start of the other simulation open by hand, starts the world's own simulation
 * behind it, checks that it waits, ends the first with `end`, and returns the second's outcome.
 */
async function behindHeldStart(w: World, end: "commit" | "rollback") {
  const { db, pool } = database();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "update simulations set state = 'running', started_at = now() where id = $1",
      [w.outsideSimulationId],
    );
    const second = startSimulation(db, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await settlesWithin(second, 300)).toBe(false);
    await client.query(end);
    return await second;
  } finally {
    client.release();
  }
}

describe("two starts at once (#386)", () => {
  // NOTE: #386; the order of the two starts is not fixed here, so either may win; the
  // forced-order cases below pin each order.
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
    const { db } = database();
    const w = await world(db);
    expect(await behindHeldStart(w, "commit")).toEqual({ ok: false, error: "another_running" });
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
    const w = await world(database().db);
    expect(await behindHeldStart(w, "rollback")).toEqual({ ok: true, value: null });
    expect(await runningIds()).toEqual([w.simulationId]);
  });

  it("refuses a start beside a finish that is not committed yet, then starts after it", async () => {
    const { db, pool } = database();
    const w = await world(db);
    const own = { simulationId: w.simulationId };
    await setState(db, w.outsideSimulationId, "running");
    const client = await pool.connect();
    try {
      // The finish of the running simulation, held open: until it commits, that one still runs.
      await client.query("begin");
      await client.query(
        "update simulations set state = 'finished', finished_at = now() where id = $1",
        [w.outsideSimulationId],
      );
      expect(await startSimulation(db, w.teacher, own, NOW)).toEqual({
        ok: false,
        error: "another_running",
      });
      await client.query("commit");
    } finally {
      client.release();
    }
    expect(await startSimulation(db, w.teacher, own, NOW)).toEqual({ ok: true, value: null });
    expect(await runningIds()).toEqual([w.simulationId]);
  });
});
