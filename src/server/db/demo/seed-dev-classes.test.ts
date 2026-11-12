// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "node:crypto";
import { type Kysely, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../schema.gen.ts";
import { createTestDb } from "../test-db.ts";
import { DEV_CLASS_ACCOUNTS } from "./dev-classes.ts";
import { seedDemoData, seedSummary } from "./seed-demo.ts";
import { DevClassUsersMissing, seedDevAccountClasses } from "./seed-dev-classes.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

/** Inserts the three dev accounts the classes go to, as `pnpm db:seed` creates them. */
async function insertDevAccounts(database: Kysely<DB>) {
  const accounts = [
    ["student", DEV_CLASS_ACCOUNTS.student, "student"],
    ["teacher", DEV_CLASS_ACCOUNTS.teacher, "teacher"],
    ["coordinator", DEV_CLASS_ACCOUNTS.coordinator, "teacher,admin"],
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

/** Returns the dev account's classes as `name year role archived`, in a stable order. */
async function classesOf(database: Kysely<DB>, userId: string) {
  const rows = await database
    .selectFrom("member")
    .innerJoin("organization", "organization.id", "member.organizationId")
    .select([
      "organization.name",
      "organization.academic_year",
      "member.role",
      "organization.archived_at",
    ])
    .where("member.userId", "=", userId)
    .orderBy("organization.academic_year", "desc")
    .orderBy("organization.name")
    .execute();
  return rows.map(
    (row) => `${row.name} ${row.academic_year} ${row.role}${row.archived_at ? " archived" : ""}`,
  );
}

describe("seedDevAccountClasses", () => {
  it("gives the dev accounts their classes (B2, D1 demo data)", async () => {
    const { database, ids } = await seeded();
    expect(await seedDevAccountClasses(database, NOW)).toBe(true);
    expect(await classesOf(database, ids.teacher)).toEqual([
      "LS-3A 2026-2027 owner",
      "LS-3B 2026-2027 teacher",
      "LS-3A 2025-2026 owner archived",
    ]);
    expect(await classesOf(database, ids.coordinator)).toEqual([
      "LS-3A 2026-2027 teacher",
      "LS-3B 2026-2027 owner",
    ]);
    expect(await classesOf(database, ids.student)).toEqual(["LS-3A 2026-2027 student"]);
  });

  it("puts Test Student in group 1 of the set Practical 1", async () => {
    const { database, ids } = await seeded();
    await seedDevAccountClasses(database, NOW);
    const groups = await database
      .selectFrom("teamMember")
      .innerJoin("team", "team.id", "teamMember.teamId")
      .select(["team.group_set", "team.name", "team.memberCount"])
      .where("teamMember.userId", "=", ids.student)
      .execute();
    expect(groups).toEqual([{ group_set: "Practical 1", name: "Group 1", memberCount: 4 }]);
  });

  it("adds three classes, two pending invitations, three lab groups and no join code", async () => {
    const { database } = await seeded();
    const before = await seedSummary(database, NOW);
    await seedDevAccountClasses(database, NOW);
    const after = await seedSummary(database, NOW);
    expect(after.classes - before.classes).toBe(3);
    expect(after.archivedClasses - before.archivedClasses).toBe(1);
    expect(after.classMembers - before.classMembers).toBe(2 + 12 + (2 + 8) + (1 + 6));
    expect(after.pendingInvitations - before.pendingInvitations).toBe(2);
    expect(after.labGroups - before.labGroups).toBe(3);
    expect(after.auditEvents - before.auditEvents).toBe(6);
    const codes = await database.selectFrom("class_join_codes").select("organization_id").execute();
    expect(codes).toEqual([]);
  });

  it("changes nothing when it runs again (idempotent)", async () => {
    const { database } = await seeded();
    expect(await seedDevAccountClasses(database, NOW)).toBe(true);
    const first = await seedSummary(database, NOW);
    expect(await seedDevAccountClasses(database, new Date(NOW.getTime() + 86_400_000))).toBe(false);
    expect(await seedDemoData(database, NOW)).toBe(false);
    expect(await seedSummary(database, NOW)).toEqual(first);
  });

  it("names only the dev accounts as actors of its activity-log events", async () => {
    const { database, ids } = await seeded();
    await seedDevAccountClasses(database, NOW);
    const ours = await database
      .selectFrom("organization")
      .select("id")
      .where("name", "in", ["LS-3A", "LS-3B"])
      .execute();
    const classIds = ours.map((row) => row.id);
    const events = await database
      .selectFrom("audit_event")
      .select(["actor_id", "action"])
      .where((eb) =>
        eb.or([
          eb.and([eb("target_type", "=", "class"), eb("target_id", "in", classIds)]),
          eb.and([
            eb("target_type", "=", "invitation"),
            eb(sql<string>`metadata->>'class_id'`, "in", classIds),
          ]),
        ]),
      )
      .execute();
    expect(events).toHaveLength(6);
    expect(new Set(events.map((event) => event.actor_id))).toEqual(
      new Set([ids.teacher, ids.coordinator]),
    );
  });

  it("refuses to run before the dev accounts exist, and writes nothing", async () => {
    const database = await createTestDb();
    db = database;
    await seedDemoData(database, NOW);
    const before = await seedSummary(database, NOW);
    await expect(seedDevAccountClasses(database, NOW)).rejects.toThrow(DevClassUsersMissing);
    expect(await seedSummary(database, NOW)).toEqual(before);
  });

  it("refuses to run before the demo set exists", async () => {
    const database = await createTestDb();
    db = database;
    await insertDevAccounts(database);
    await expect(seedDevAccountClasses(database, NOW)).rejects.toMatchObject({ missing: 25 });
  });
});
