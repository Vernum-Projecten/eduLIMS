// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import { readAdminSimulation, readAdminSimulations } from "./admin-queries.ts";
import { person, type World, world } from "./test-helpers.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function open(): Promise<{ database: Kysely<DB>; w: World }> {
  db = await createTestDb();
  const w = await world(db);
  await db
    .insertInto("lab_member_emails")
    .values({ simulation_id: w.simulationId, lab_id: w.labId, email: "waits@example.test" })
    .execute();
  return { database: db, w };
}

describe("readAdminSimulations (B5: read-only, nothing of a lab's work)", () => {
  it("returns exactly the B5 fields, as the client receives them", async () => {
    const { database, w } = await open();
    const rows = await readAdminSimulations(database, w.admin);
    const serialised = JSON.parse(JSON.stringify(rows));
    expect(serialised).toEqual([
      {
        id: w.outsideSimulationId,
        name: "Other simulation",
        createdAt: expect.any(String),
        teachers: ["Test outsider-teacher"],
        labs: [{ id: w.outsideLabId, name: "Lab Osprey", members: 1 }],
      },
      {
        id: w.simulationId,
        name: "Practice simulation",
        createdAt: expect.any(String),
        teachers: ["Test co-teacher", "Test teacher"],
        labs: [
          { id: w.otherLabId, name: "Blue Cuvettes", members: 1 },
          { id: w.labId, name: "Pipette Pilots", members: 6 },
        ],
      },
    ]);
  });

  it("carries no address, no student name, no code state and no logo (B5, R-01)", async () => {
    const { database, w } = await open();
    const text = JSON.stringify(await readAdminSimulations(database, w.admin));
    expect(text).not.toContain("@");
    expect(text).not.toContain("Test student");
    expect(text).not.toMatch(/code|logo|email|waiting/i);
  });

  it("lets a teacher-administrator read as an administrator", async () => {
    const { database } = await open();
    const both = await person(database, "both", ["teacher", "admin"]);
    expect(await readAdminSimulations(database, both)).toHaveLength(2);
  });

  it.each([
    ["a student of a lab", (w: World) => w.student],
    ["a student of another lab", (w: World) => w.otherLabStudent],
    ["a student outside the simulation", (w: World) => w.outsideStudent],
    ["a teacher of the simulation", (w: World) => w.teacher],
    ["a teacher of another simulation", (w: World) => w.outsiderTeacher],
  ])("refuses %s with 403", async (_who, actorOf) => {
    const { database, w } = await open();
    expect(() => readAdminSimulations(database, actorOf(w))).toThrow(AuthError);
  });
});

describe("readAdminSimulation (B5)", () => {
  it("returns one simulation with the same fields", async () => {
    const { database, w } = await open();
    const one = await readAdminSimulation(database, w.admin, w.simulationId);
    expect(Object.keys(one ?? {}).sort()).toEqual(["createdAt", "id", "labs", "name", "teachers"]);
    expect(one?.labs.map((lab) => lab.members)).toEqual([1, 6]);
  });

  it("returns null for a malformed or unknown id", async () => {
    const { database, w } = await open();
    expect(await readAdminSimulation(database, w.admin, "not-a-uuid")).toBeNull();
    expect(
      await readAdminSimulation(database, w.admin, "01960000-0000-7000-8000-000000000001"),
    ).toBeNull();
  });

  it.each([
    ["a student of a lab", (w: World) => w.student],
    ["a student of another lab", (w: World) => w.otherLabStudent],
    ["a student outside the simulation", (w: World) => w.outsideStudent],
    ["a teacher of the simulation", (w: World) => w.teacher],
    ["a teacher of another simulation", (w: World) => w.outsiderTeacher],
  ])("refuses %s with 403", async (_who, actorOf) => {
    const { database, w } = await open();
    await expect(readAdminSimulation(database, actorOf(w), w.simulationId)).rejects.toThrow(
      AuthError,
    );
  });
});
