// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../schema.gen.ts";
import { createTestDb } from "../test-db.ts";
import { DEV_SIMULATION_ACCOUNTS, DEV_WAITING_ADDRESSES } from "./dev-simulations.ts";
import { seedDemoData, seedSummary } from "./seed-demo.ts";
import { DevSimulationUsersMissing, seedDevAccountSimulations } from "./seed-dev-simulations.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

/** Inserts the three dev accounts the simulations go to, as `pnpm db:seed` creates them. */
async function insertDevAccounts(database: Kysely<DB>) {
  const accounts = [
    ["student", DEV_SIMULATION_ACCOUNTS.student, "student"],
    ["teacher", DEV_SIMULATION_ACCOUNTS.teacher, "teacher"],
    ["coordinator", DEV_SIMULATION_ACCOUNTS.coordinator, "teacher,admin"],
  ] as const;
  const ids = { student: randomUUID(), teacher: randomUUID(), coordinator: randomUUID() };
  for (const [key, email, role] of accounts) {
    await database
      .insertInto("user")
      .values({ id: ids[key], name: `Test ${key}`, email, emailVerified: true, role })
      .execute();
  }
  return ids;
}

async function seeded() {
  const database = await createTestDb();
  db = database;
  expect(await seedDemoData(database, NOW)).toBe(true);
  const ids = await insertDevAccounts(database);
  return { database, ids };
}

/** Returns the simulations a dev account teaches, by name. */
async function taughtBy(database: Kysely<DB>, userId: string) {
  const rows = await database
    .selectFrom("simulation_teachers")
    .innerJoin("simulations", "simulations.id", "simulation_teachers.simulation_id")
    .select("simulations.name")
    .where("simulation_teachers.user_id", "=", userId)
    .orderBy("simulations.name")
    .execute();
  return rows.map((row) => row.name);
}

describe("seedDevAccountSimulations", () => {
  it("lets both dev teachers teach both dev simulations (D10 demo data)", async () => {
    const { database, ids } = await seeded();
    expect(await seedDevAccountSimulations(database, NOW)).toBe(true);
    const both = ["Coordinator's simulation", "Demo simulation"];
    expect(await taughtBy(database, ids.teacher)).toEqual(both);
    expect(await taughtBy(database, ids.coordinator)).toEqual(both);
  });

  it("puts Test Student in Lab Aurora, a lab of six (S10)", async () => {
    const { database, ids } = await seeded();
    await seedDevAccountSimulations(database, NOW);
    const place = await database
      .selectFrom("lab_members")
      .innerJoin("labs", "labs.id", "lab_members.lab_id")
      .select(["labs.id", "labs.name"])
      .where("lab_members.user_id", "=", ids.student)
      .executeTakeFirstOrThrow();
    expect(place.name).toBe("Lab Aurora");
    const size = await database
      .selectFrom("lab_members")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("lab_id", "=", place.id)
      .executeTakeFirstOrThrow();
    expect(Number(size.n)).toBe(6);
  });

  it("adds two simulations, three labs, eighteen students and two waiting addresses", async () => {
    const { database } = await seeded();
    const before = await seedSummary(database, NOW);
    await seedDevAccountSimulations(database, NOW);
    const after = await seedSummary(database, NOW);
    expect(after.simulations - before.simulations).toBe(2);
    expect(after.labs - before.labs).toBe(3);
    expect(after.labMembers - before.labMembers).toBe(18);
    expect(after.waitingAddresses - before.waitingAddresses).toBe(DEV_WAITING_ADDRESSES.length);
    const codes = await database.selectFrom("lab_join_codes").select("lab_id").execute();
    expect(codes).toEqual([]);
  });

  it("changes nothing when it runs again (idempotent)", async () => {
    const { database } = await seeded();
    expect(await seedDevAccountSimulations(database, NOW)).toBe(true);
    const first = await seedSummary(database, NOW);
    expect(await seedDevAccountSimulations(database, new Date(NOW.getTime() + 86_400_000))).toBe(
      false,
    );
    expect(await seedDemoData(database, NOW)).toBe(false);
    expect(await seedSummary(database, NOW)).toEqual(first);
  });

  it("logs its simulations with the dev teachers as actors and no address (B4)", async () => {
    const { database, ids } = await seeded();
    await seedDevAccountSimulations(database, NOW);
    const ours = await database
      .selectFrom("simulations")
      .select("id")
      .where("name", "in", ["Demo simulation", "Coordinator's simulation"])
      .execute();
    const events = await database
      .selectFrom("audit_event")
      .select(["actor_id", "action", "metadata"])
      .where("target_type", "=", "simulation")
      .where(
        "target_id",
        "in",
        ours.map((row) => row.id),
      )
      .execute();
    expect(events.map((event) => event.action).sort()).toEqual([
      "simulation_created",
      "simulation_created",
      "simulation_teacher_added",
      "simulation_teacher_added",
    ]);
    expect(new Set(events.map((event) => event.actor_id))).toEqual(
      new Set([ids.teacher, ids.coordinator]),
    );
    expect(JSON.stringify(events)).not.toContain("@");
  });

  it("refuses to run before the dev accounts exist, and writes nothing", async () => {
    const database = await createTestDb();
    db = database;
    await seedDemoData(database, NOW);
    const before = await seedSummary(database, NOW);
    await expect(seedDevAccountSimulations(database, NOW)).rejects.toThrow(
      DevSimulationUsersMissing,
    );
    expect(await seedSummary(database, NOW)).toEqual(before);
  });

  it("refuses to run before the demo set exists", async () => {
    const database = await createTestDb();
    db = database;
    await insertDevAccounts(database);
    await expect(seedDevAccountSimulations(database, NOW)).rejects.toMatchObject({ missing: 17 });
  });
});
