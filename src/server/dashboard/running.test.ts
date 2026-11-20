// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Which simulation the teacher dashboard shows (D11, #386): the running one to its teachers,
// an empty state otherwise that names no other teacher's simulation, and nothing for a student
// or an administrator.
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { finishSimulation, startSimulation } from "../simulations/state.ts";
import { NOW, type Person, type World, world } from "../simulations/test-helpers.ts";
import { readRunningSimulation } from "./running.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open() {
  db = await createTestDb();
  return { database: db, w: await world(db) };
}

async function start(database: Kysely<DB>, w: World) {
  const started = await startSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
  if (!started.ok) throw new Error(started.error);
}

describe("readRunningSimulation (D11, #386)", () => {
  it("shows none when no simulation runs", async () => {
    const { database, w } = await open();
    expect(await readRunningSimulation(database, w.teacher)).toEqual({ kind: "none" });
  });

  it("shows the running simulation to its teacher and its co-teacher", async () => {
    const { database, w } = await open();
    await start(database, w);
    const expected = {
      kind: "running",
      simulation: { id: w.simulationId, name: "Practice simulation", startedAt: NOW.toISOString() },
    };
    expect(await readRunningSimulation(database, w.teacher)).toEqual(expected);
    expect(await readRunningSimulation(database, w.coTeacher)).toEqual(expected);
  });

  it("tells a teacher of another simulation only that it is not theirs", async () => {
    const { database, w } = await open();
    await start(database, w);
    expect(await readRunningSimulation(database, w.outsiderTeacher)).toEqual({
      kind: "not_taught",
    });
  });

  it("shows none again once the simulation is finished", async () => {
    const { database, w } = await open();
    await start(database, w);
    await finishSimulation(database, w.teacher, { simulationId: w.simulationId }, NOW);
    expect(await readRunningSimulation(database, w.teacher)).toEqual({ kind: "none" });
  });

  const forbidden: [string, (w: World) => Person][] = [
    ["a student of the simulation", (w) => w.student],
    ["a student outside it", (w) => w.outsideStudent],
    ["an administrator", (w) => w.admin],
  ];
  for (const [who, actorOf] of forbidden) {
    it(`refuses ${who} with 403 (D11, Q-SIM-1)`, async () => {
      const { database, w } = await open();
      await start(database, w);
      await expect(readRunningSimulation(database, actorOf(w))).rejects.toThrow(AuthError);
    });
  }
});
