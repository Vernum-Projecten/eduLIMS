// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One running simulation at a time (D11, owner 2026-11-20, #386): the refusal checks the
// ownership first, answers a teacher of both simulations the same, and fails loud on any database
// error that is not the index of migration 0030.
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { isOneRunningViolation, startSimulation } from "./state.ts";
import {
  auditRows,
  NOW,
  notFoundLine,
  securityLines,
  setState,
  startable,
  world,
} from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

describe("isOneRunningViolation (#386)", () => {
  it("is true for the unique violation of simulations_one_running", () => {
    expect(isOneRunningViolation({ code: "23505", constraint: "simulations_one_running" })).toBe(
      true,
    );
  });

  it("is false for another unique violation", () => {
    expect(isOneRunningViolation({ code: "23505", constraint: "simulations_pkey" })).toBe(false);
  });

  it("is false for a deadlock", () => {
    expect(isOneRunningViolation({ code: "40P01" })).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "23505 simulations_one_running"],
  ])("is false for %s", (_, error) => {
    expect(isOneRunningViolation(error)).toBe(false);
  });
});

describe("the start while another simulation runs (#386)", () => {
  it("answers a teacher who does not teach the simulation not_found and logs the probe first", async () => {
    const { database, w } = await open();
    await setState(database, w.outsideSimulationId, "running");
    let answer: unknown;
    const lines = await securityLines(async () => {
      answer = await startSimulation(
        database,
        w.outsiderTeacher,
        { simulationId: w.simulationId },
        NOW,
      );
    });
    expect(answer).toEqual({ ok: false, error: "not_found" });
    expect(lines).toEqual([notFoundLine(w.outsiderTeacher.id, "simulation", w.simulationId)]);
    expect(await auditRows(database, "simulation_started")).toEqual([]);
  });

  it("answers a teacher of both simulations the same another_running, naming neither", async () => {
    const { database, w } = await open();
    await database
      .insertInto("simulation_teachers")
      .values({ simulation_id: w.outsideSimulationId, user_id: w.teacher.id })
      .execute();
    await setState(database, w.outsideSimulationId, "running");
    expect(
      await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW),
    ).toEqual({ ok: false, error: "another_running" });
  });

  it("fails loud on another database error in the start, writing nothing", async () => {
    const { database, w } = await open();
    // A test-only trigger that refuses the start's update with an error that is not the index's.
    await sql`create function test_refuse_start() returns trigger language plpgsql as $$
      begin raise exception 'test refusal' using errcode = 'P0001'; end $$`.execute(database);
    await sql`create trigger test_refuse_start before update on simulations
      for each row when (new.state = 'running') execute function test_refuse_start()`.execute(
      database,
    );
    await startable(database, w.simulationId);
    await expect(
      startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW),
    ).rejects.toThrow(/test refusal/);
    const row = await database
      .selectFrom("simulations")
      .select(["state", "started_at"])
      .where("id", "=", w.simulationId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ state: "prepared", started_at: null });
    expect(await auditRows(database, "simulation_started")).toEqual([]);
  });
});
