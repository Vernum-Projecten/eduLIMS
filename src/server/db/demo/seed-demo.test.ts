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

  it("seeds the demo classes of #28: this year, last year archived, shared, invited, grouped", async () => {
    const database = await seeded();
    const summary = await seedSummary(database, NOW);
    expect(summary).toMatchObject({
      classes: 3,
      archivedClasses: 1,
      pendingInvitations: 2,
      labGroups: 3,
    });
    const classes = await database
      .selectFrom("organization")
      .select(["name", "academic_year", "archived_at"])
      .orderBy("academic_year")
      .orderBy("name")
      .execute();
    expect(classes.map((row) => [row.name, row.academic_year, row.archived_at !== null])).toEqual([
      ["LS-2A", "2025-2026", true],
      ["LS-2A", "2026-2027", false],
      ["LS-2B", "2026-2027", false],
    ]);
    const owners = await database
      .selectFrom("member")
      .select("userId")
      .distinct()
      .where("role", "=", "owner")
      .execute();
    expect(owners).toHaveLength(2);
    const shared = await database
      .selectFrom("member")
      .select("organizationId")
      .where("role", "=", "teacher")
      .execute();
    expect(shared).toHaveLength(1);
    const groups = await database
      .selectFrom("team")
      .innerJoin("teamMember", "teamMember.teamId", "team.id")
      .innerJoin("member", (join) =>
        join
          .onRef("member.userId", "=", "teamMember.userId")
          .onRef("member.organizationId", "=", "team.organizationId"),
      )
      .select(["team.group_set", "member.role"])
      .execute();
    expect(new Set(groups.map((row) => `${row.group_set}:${row.role}`))).toEqual(
      new Set(["Practical 1:student"]),
    );
  });

  it("adds the classes to a database seeded before they existed, once", async () => {
    const database = await seeded();
    await database.deleteFrom("organization").execute();
    expect(await seedDemoData(database, NOW)).toBe(true);
    expect((await seedSummary(database, NOW)).classes).toBe(3);
    expect(await seedDemoData(database, new Date(NOW.getTime() + 86_400_000))).toBe(false);
    expect((await seedSummary(database, NOW)).classes).toBe(3);
  });

  it("gives every demo class id the UUID shape the class pages accept", () => {
    for (const item of planDemoData(NOW).classes.classes) {
      expect(item.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
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
