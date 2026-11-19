// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { pruneRetention } from "../../audit/retention.ts";
import type { DB } from "../schema.gen.ts";
import { createTestDb } from "../test-db.ts";
import { FAMILY_NAMES } from "./names.ts";
import { planDemoData, seedDemoData, seedSummary } from "./seed-demo.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function seeded() {
  const database = await createTestDb();
  db = database;
  expect(await seedDemoData(database, NOW)).toBe(true);
  return database;
}

describe("the demo plan", () => {
  it("plans 60 students, 6 teachers, 2 administrators and 2 coordinators", () => {
    const { users } = planDemoData(NOW).people;
    const byKind = Object.groupBy(users, (user) => user.kind);
    expect(byKind.student).toHaveLength(60);
    expect(byKind.teacher).toHaveLength(6);
    expect(byKind.admin).toHaveLength(2);
    expect(byKind.coordinator?.map((user) => user.role)).toEqual([
      "teacher,admin",
      "teacher,admin",
    ]);
  });

  it("is the same on every run", () => {
    expect(planDemoData(NOW)).toEqual(planDemoData(NOW));
  });

  it("uses unique @example.test addresses only", () => {
    const emails = planDemoData(NOW).people.users.map((user) => user.email);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(email).toMatch(/^[a-z]+\.[a-z]+@example\.test$/);
  });

  it("blocks three students, one of them until an end date", () => {
    const blocked = planDemoData(NOW).people.users.filter((user) => user.ban);
    expect(blocked.map((user) => user.kind)).toEqual(["student", "student", "student"]);
    expect(blocked.filter((user) => user.ban?.expires)).toHaveLength(1);
  });

  it("spans about four weeks of activity", () => {
    const { activity } = planDemoData(NOW);
    const signIns = activity.filter((event) => event.action === "authn_login_success");
    const oldest = Math.min(...signIns.map((event) => event.occurredAt?.getTime() ?? 0));
    expect((NOW.getTime() - oldest) / 86_400_000).toBeGreaterThan(26);
    expect(signIns.every((event) => (event.occurredAt?.getTime() ?? 0) < NOW.getTime())).toBe(true);
  });
});

describe("seedDemoData", () => {
  it("leaves the same data when it runs twice (idempotent)", async () => {
    const database = await seeded();
    const first = await seedSummary(database, NOW);
    expect(await seedDemoData(database, NOW)).toBe(false);
    expect(await seedSummary(database, NOW)).toEqual(first);
    expect(first.usersByRole).toEqual({ admin: 2, student: 60, teacher: 6, "teacher,admin": 2 });
    expect(first.blockedUsers).toBe(3);
    expect(first.activeSessions).toBeGreaterThan(10);
    expect(first.expiredSessions).toBeGreaterThan(10);
    expect(Object.keys(first.accountsByProvider)).toEqual(["keycloak", "keycloak-saml"]);
  });

  it("seeds two invented simulations with labs of six students and one waiting address", async () => {
    const database = await seeded();
    const summary = await seedSummary(database, NOW);
    expect(summary).toMatchObject({
      simulations: 2,
      labs: 6,
      labMembers: 35,
      waitingAddresses: 1,
    });
    const labs = await database
      .selectFrom("labs")
      .innerJoin("simulations", "simulations.id", "labs.simulation_id")
      .select((eb) => [
        "simulations.name as simulation",
        "labs.name as lab",
        eb
          .selectFrom("lab_members")
          .select((mb) => mb.fn.countAll<string>().as("n"))
          .whereRef("lab_members.lab_id", "=", "labs.id")
          .as("members"),
      ])
      .orderBy("simulations.name")
      .orderBy("labs.name")
      .execute();
    expect(labs.map((row) => [row.simulation, row.lab, Number(row.members)])).toEqual([
      ["Autumn simulation", "Lab Kestrel", 6],
      ["Autumn simulation", "Lab Osprey", 6],
      ["Spring simulation", "Blue Cuvettes", 6],
      ["Spring simulation", "Night Shift Lab", 5],
      ["Spring simulation", "Pipette Pilots", 6],
      ["Spring simulation", "The Centrifugals", 6],
    ]);
    const shared = await database
      .selectFrom("simulation_teachers")
      .select("simulation_id")
      .groupBy("simulation_id")
      .having((eb) => eb.fn.countAll(), ">", 1)
      .execute();
    expect(shared).toHaveLength(1);
  });

  it("adds the simulations to a database whose simulations were deleted, once", async () => {
    const database = await seeded();
    await database.deleteFrom("simulations").execute();
    expect(await seedDemoData(database, NOW)).toBe(true);
    expect((await seedSummary(database, NOW)).simulations).toBe(2);
    expect(await seedDemoData(database, new Date(NOW.getTime() + 86_400_000))).toBe(false);
    expect((await seedSummary(database, NOW)).simulations).toBe(2);
  });

  it("gives every demo simulation and lab id the UUID shape the pages accept", () => {
    for (const simulation of planDemoData(NOW).simulations.simulations) {
      for (const id of [simulation.id, ...simulation.labs.map((lab) => lab.id)]) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
    }
  });

  it("gives the demo people no password", async () => {
    const database = await seeded();
    const withPassword = await database
      .selectFrom("account")
      .select("id")
      .where("password", "is not", null)
      .execute();
    expect(withPassword).toEqual([]);
  });

  it("writes no personal data into the activity log (B4)", async () => {
    const database = await seeded();
    const rows = await database
      .selectFrom("audit_event")
      .select(sql<string>`row_to_json(audit_event)::text`.as("row"))
      .execute();
    const log = rows.map((row) => row.row).join("\n");
    expect(rows.length).toBeGreaterThan(200);
    expect(log).not.toContain("@");
    const users = await database.selectFrom("user").select(["name", "banReason"]).execute();
    for (const user of users) {
      expect(log).not.toContain(user.name);
      if (user.banReason) expect(log).not.toContain(user.banReason);
    }
    for (const family of FAMILY_NAMES) expect(log).not.toContain(family);
    expect(log).not.toMatch(/192\.0\.2\./);
  });

  it("names only seeded users as actors and user targets", async () => {
    const database = await seeded();
    const orphans = await database
      .selectFrom("audit_event")
      .select("id")
      .where((eb) =>
        eb.or([
          eb.and([
            eb("actor_id", "is not", null),
            eb.not(
              eb.exists(eb.selectFrom("user").select("id").whereRef("user.id", "=", "actor_id")),
            ),
          ]),
          eb.and([
            eb("target_type", "=", "user"),
            eb.not(
              eb.exists(eb.selectFrom("user").select("id").whereRef("user.id", "=", "target_id")),
            ),
          ]),
        ]),
      )
      .execute();
    expect(orphans).toEqual([]);
  });

  it("holds expired sessions the prune removes, and keeps the recent ones", async () => {
    const database = await seeded();
    const before = await seedSummary(database, NOW);
    const { sessions, auditEvents } = await pruneRetention(database, NOW);
    expect(sessions).toBeGreaterThan(0);
    expect(auditEvents).toBe(0);
    const after = await seedSummary(database, NOW);
    expect(after.activeSessions).toBe(before.activeSessions);
    expect(after.expiredSessions).toBe(before.expiredSessions - sessions);
  });
});
