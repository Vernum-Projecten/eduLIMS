// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import {
  countAdminSimulations,
  readAdminSimulation,
  readAdminSimulationPage,
} from "./admin-queries.ts";
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

/** Adds a simulation taught by `teacherId` without a lab, created at `createdAt`. */
async function addSimulation(
  database: Kysely<DB>,
  teacherId: string,
  name: string,
  createdAt = new Date("2026-11-01T09:00:00Z"),
): Promise<string> {
  const { id } = await database
    .insertInto("simulations")
    .values({ name, created_by: teacherId, created_at: createdAt })
    .returning("id")
    .executeTakeFirstOrThrow();
  await database
    .insertInto("simulation_teachers")
    .values({ simulation_id: id, user_id: teacherId })
    .execute();
  return id;
}

/** The B5 fields and the marker of #291, and nothing else. */
const FIELDS = ["createdAt", "hasActiveTeacher", "id", "labs", "name", "teachers"];

const REFUSED = [
  ["a student of a lab", (w: World) => w.student],
  ["a student of another lab", (w: World) => w.otherLabStudent],
  ["a student outside the simulation", (w: World) => w.outsideStudent],
  ["a teacher of the simulation", (w: World) => w.teacher],
  ["a teacher of another simulation", (w: World) => w.outsiderTeacher],
] as const;

describe("readAdminSimulationPage (B5: read-only, nothing of a lab's work)", () => {
  it("returns exactly the B5 fields, as the client receives them", async () => {
    const { database, w } = await open();
    const page = await readAdminSimulationPage(database, w.admin, {});
    const serialised = JSON.parse(JSON.stringify(page));
    expect(serialised).toEqual({
      rows: [
        {
          id: w.outsideSimulationId,
          name: "Other simulation",
          createdAt: expect.any(String),
          teachers: ["Test outsider-teacher"],
          hasActiveTeacher: true,
          labs: [{ id: w.outsideLabId, name: "Lab Osprey", members: 1 }],
        },
        {
          id: w.simulationId,
          name: "Practice simulation",
          createdAt: expect.any(String),
          teachers: ["Test co-teacher", "Test teacher"],
          hasActiveTeacher: true,
          labs: [
            { id: w.otherLabId, name: "Blue Cuvettes", members: 1 },
            { id: w.labId, name: "Pipette Pilots", members: 6 },
          ],
        },
      ],
      total: 2,
      page: 1,
      size: 25,
    });
  });

  it("carries no address, no student name, no code state and no logo (B5, R-01)", async () => {
    const { database, w } = await open();
    const text = JSON.stringify(await readAdminSimulationPage(database, w.admin, {}));
    expect(text).not.toContain("@");
    expect(text).not.toContain("Test student");
    expect(text).not.toMatch(/code|logo|email|waiting/i);
  });

  it("lets a teacher-administrator read as an administrator", async () => {
    const { database } = await open();
    const both = await person(database, "both", ["teacher", "admin"]);
    expect((await readAdminSimulationPage(database, both, {})).total).toBe(2);
  });

  it("pages newest first with the id as tie-breaker, the same rows on every read (#291)", async () => {
    const { database, w } = await open();
    const same = new Date("2026-10-01T09:00:00Z");
    const ids: string[] = [];
    for (const n of [1, 2, 3, 4, 5]) {
      ids.push(await addSimulation(database, w.teacher.id, `Paged ${n}`, same));
    }
    const expected = [...ids].sort().reverse();
    const first = await readAdminSimulationPage(database, w.admin, { q: "Paged", size: 10 });
    expect(first.rows.map((row) => row.id)).toEqual(expected);
    const again = await readAdminSimulationPage(database, w.admin, { q: "Paged", size: 10 });
    expect(again.rows.map((row) => row.id)).toEqual(expected);
  });

  it("returns the page asked for, with the total of every page", async () => {
    const { database, w } = await open();
    for (let n = 1; n <= 12; n += 1) {
      await addSimulation(
        database,
        w.teacher.id,
        `Batch ${String(n).padStart(2, "0")}`,
        new Date(Date.UTC(2026, 9, n)),
      );
    }
    const page = await readAdminSimulationPage(database, w.admin, {
      q: "Batch",
      size: 10,
      page: 2,
    });
    expect(page.total).toBe(12);
    expect(page.page).toBe(2);
    expect(page.size).toBe(10);
    expect(page.rows.map((row) => row.name)).toEqual(["Batch 02", "Batch 01"]);
    const past = await readAdminSimulationPage(database, w.admin, {
      q: "Batch",
      size: 10,
      page: 3,
    });
    expect(past.rows).toEqual([]);
    expect(past.total).toBe(12);
  });

  it("searches the name only, ignoring case", async () => {
    const { database, w } = await open();
    const page = await readAdminSimulationPage(database, w.admin, { q: "PRACTICE" });
    expect(page.rows.map((row) => row.id)).toEqual([w.simulationId]);
    expect((await readAdminSimulationPage(database, w.admin, { q: "Osprey" })).total).toBe(0);
    expect((await readAdminSimulationPage(database, w.admin, { q: "Test teacher" })).total).toBe(0);
  });

  it("takes LIKE wildcards in the search literally", async () => {
    const { database, w } = await open();
    const percent = await addSimulation(database, w.teacher.id, "Rate 100% done");
    await addSimulation(database, w.teacher.id, "Rate 100 percent");
    const underscore = await addSimulation(database, w.teacher.id, "Run_A");
    await addSimulation(database, w.teacher.id, "RunXA");
    const backslash = await addSimulation(database, w.teacher.id, "Path \\ split");
    const ids = async (q: string) =>
      (await readAdminSimulationPage(database, w.admin, { q })).rows.map((row) => row.id);
    expect(await ids("100%")).toEqual([percent]);
    expect(await ids("n_A")).toEqual([underscore]);
    expect(await ids("\\")).toEqual([backslash]);
    expect(await ids("%")).toEqual([percent]);
  });

  it("marks a simulation whose teachers all lost the app role teacher (#291)", async () => {
    const { database, w } = await open();
    await database
      .updateTable("user")
      .set({ role: "admin" })
      .where("id", "=", w.outsiderTeacher.id)
      .execute();
    const page = await readAdminSimulationPage(database, w.admin, {});
    const marker = Object.fromEntries(page.rows.map((row) => [row.id, row.hasActiveTeacher]));
    expect(marker).toEqual({ [w.outsideSimulationId]: false, [w.simulationId]: true });
    const former = page.rows.find((row) => row.id === w.outsideSimulationId);
    expect(former?.teachers).toEqual(["Test outsider-teacher"]);
  });

  it("keeps a simulation active while one of its teachers holds the role", async () => {
    const { database, w } = await open();
    await database
      .updateTable("user")
      .set({ role: "admin" })
      .where("id", "=", w.teacher.id)
      .execute();
    const one = await readAdminSimulation(database, w.admin, w.simulationId);
    expect(one?.hasActiveTeacher).toBe(true);
    await database
      .updateTable("user")
      .set({ role: "student" })
      .where("id", "=", w.coTeacher.id)
      .execute();
    const none = await readAdminSimulation(database, w.admin, w.simulationId);
    expect(none?.hasActiveTeacher).toBe(false);
  });

  it("counts a teacher-administrator as an active teacher", async () => {
    const { database, w } = await open();
    await database
      .updateTable("user")
      .set({ role: "teacher,admin" })
      .where("id", "=", w.outsiderTeacher.id)
      .execute();
    const one = await readAdminSimulation(database, w.admin, w.outsideSimulationId);
    expect(one?.hasActiveTeacher).toBe(true);
  });

  it.each(REFUSED)("refuses %s with 403", async (_who, actorOf) => {
    const { database, w } = await open();
    await expect(readAdminSimulationPage(database, actorOf(w), {})).rejects.toThrow(AuthError);
  });
});

describe("readAdminSimulation (B5)", () => {
  it("returns one simulation with the same fields", async () => {
    const { database, w } = await open();
    const one = await readAdminSimulation(database, w.admin, w.simulationId);
    expect(Object.keys(one ?? {}).sort()).toEqual(FIELDS);
    expect(one?.labs.map((lab) => lab.members)).toEqual([1, 6]);
    expect(one?.hasActiveTeacher).toBe(true);
  });

  it("returns null for a malformed or unknown id", async () => {
    const { database, w } = await open();
    expect(await readAdminSimulation(database, w.admin, "not-a-uuid")).toBeNull();
    expect(
      await readAdminSimulation(database, w.admin, "01960000-0000-7000-8000-000000000001"),
    ).toBeNull();
  });

  it("carries no address, no student name, no code state and no logo (B5, R-01)", async () => {
    const { database, w } = await open();
    const text = JSON.stringify(await readAdminSimulation(database, w.admin, w.simulationId));
    expect(text).not.toContain("@");
    expect(text).not.toContain("Test student");
    expect(text).not.toMatch(/code|logo|email|waiting/i);
  });

  it.each(REFUSED)("refuses %s with 403", async (_who, actorOf) => {
    const { database, w } = await open();
    await expect(readAdminSimulation(database, actorOf(w), w.simulationId)).rejects.toThrow(
      AuthError,
    );
  });
});

describe("countAdminSimulations (#291)", () => {
  it("counts every simulation", async () => {
    const { database, w } = await open();
    expect(await countAdminSimulations(database, w.admin)).toBe(2);
  });

  it.each(REFUSED)("refuses %s with 403", async (_who, actorOf) => {
    const { database, w } = await open();
    await expect(countAdminSimulations(database, actorOf(w))).rejects.toThrow(AuthError);
  });
});
