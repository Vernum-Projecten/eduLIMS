// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { Role } from "../../lib/roles.ts";
import { seedDemoData } from "../db/demo/seed-demo.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { AuthError } from "../middleware.ts";
import {
  accountCounts,
  RECENT_EVENTS_LIMIT,
  readAdminOverview,
  recentActivity,
} from "./queries.ts";

const NOW = new Date("2026-11-12T10:00:00Z");
const HOUR = 3_600_000;
const ADMIN: { roles: Role[] } = { roles: ["admin"] };

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

async function testDb(): Promise<Kysely<DB>> {
  db = await createTestDb();
  return db;
}

async function insertUser(
  database: Kysely<DB>,
  input: { role: string | null; banned?: boolean; banExpires?: Date | null; name?: string },
): Promise<string> {
  const id = randomUUID();
  await database
    .insertInto("user")
    .values({
      id,
      name: input.name ?? `Test ${id.slice(0, 8)}`,
      email: `${id}@example.test`,
      emailVerified: true,
      role: input.role,
      banned: input.banned ?? false,
      banExpires: input.banExpires ?? null,
    })
    .execute();
  return id;
}

async function insertSession(database: Kysely<DB>, userId: string, expiresAt: Date) {
  await database
    .insertInto("session")
    .values({
      id: randomUUID(),
      token: randomUUID(),
      userId,
      expiresAt,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .execute();
}

describe("accountCounts (#36)", () => {
  it("counts the users per role, a teacher-administrator under both roles", async () => {
    const database = await testDb();
    const before = await accountCounts(database, NOW);
    await insertUser(database, { role: "student" });
    await insertUser(database, { role: "student" });
    await insertUser(database, { role: "teacher" });
    await insertUser(database, { role: "teacher,admin" });
    await insertUser(database, { role: "admin" });
    await insertUser(database, { role: null });
    const after = await accountCounts(database, NOW);
    expect(after.users - before.users).toBe(6);
    expect(after.students - before.students).toBe(2);
    expect(after.teachers - before.teachers).toBe(2);
    expect(after.admins - before.admins).toBe(2);
  });

  it("counts a block without an end or ending later, not one that has ended", async () => {
    const database = await testDb();
    const before = await accountCounts(database, NOW);
    await insertUser(database, { role: "student", banned: true });
    await insertUser(database, {
      role: "student",
      banned: true,
      banExpires: new Date(NOW.getTime() + HOUR),
    });
    await insertUser(database, {
      role: "student",
      banned: true,
      banExpires: new Date(NOW.getTime() - HOUR),
    });
    await insertUser(database, { role: "student" });
    const after = await accountCounts(database, NOW);
    expect(after.blockedUsers - before.blockedUsers).toBe(2);
  });

  it("counts the unexpired sessions only", async () => {
    const database = await testDb();
    const before = await accountCounts(database, NOW);
    const user = await insertUser(database, { role: "teacher" });
    await insertSession(database, user, new Date(NOW.getTime() + HOUR));
    await insertSession(database, user, new Date(NOW.getTime() + 2 * HOUR));
    await insertSession(database, user, new Date(NOW.getTime() - HOUR));
    const after = await accountCounts(database, NOW);
    expect(after.activeSessions - before.activeSessions).toBe(2);
  });
});

describe("accountCounts of classes (#28)", () => {
  it("counts the active classes and the pending, unexpired invitations", async () => {
    const database = await testDb();
    const before = await accountCounts(database, NOW);
    const owner = await insertUser(database, { role: "teacher" });
    const classes = [
      ["01960000-0000-7000-8000-0000000000a1", null],
      ["01960000-0000-7000-8000-0000000000a2", NOW],
    ] as const;
    for (const [id, archivedAt] of classes) {
      await database
        .insertInto("organization")
        .values({
          id,
          slug: id,
          name: "LS-2A",
          academic_year: "2026-2027",
          createdAt: NOW,
          archived_at: archivedAt,
        })
        .execute();
    }
    const invitations = [
      ["live", "pending", NOW.getTime() + HOUR],
      ["expired", "pending", NOW.getTime() - HOUR],
      ["accepted", "accepted", NOW.getTime() + HOUR],
    ] as const;
    for (const [key, status, expiresAt] of invitations) {
      await database
        .insertInto("invitation")
        .values({
          id: randomUUID(),
          organizationId: classes[0][0],
          email: `${key}@example.test`,
          role: "student",
          status,
          ended_at: status === "pending" ? null : NOW,
          expiresAt: new Date(expiresAt),
          createdAt: NOW,
          inviterId: owner,
        })
        .execute();
    }
    const after = await accountCounts(database, NOW);
    expect(after.classes - before.classes).toBe(1);
    expect(after.pendingInvitations - before.pendingInvitations).toBe(1);
  });
});

describe("recentActivity (#36, B4)", () => {
  async function insertEvent(
    database: Kysely<DB>,
    occurredAt: Date,
    actor: { type: "user"; id: string } | { type: "system" | "anonymous" },
    action = "authn_login_success",
  ) {
    await database
      .insertInto("audit_event")
      .values({
        action,
        outcome: "success",
        occurred_at: occurredAt,
        actor_type: actor.type,
        actor_id: actor.type === "user" ? actor.id : null,
      })
      .execute();
  }

  it("returns the latest events newest first, at most the limit", async () => {
    const database = await testDb();
    const user = await insertUser(database, { role: "student", name: "Test Overview" });
    const future = NOW.getTime() + 1_000 * HOUR;
    for (let i = 0; i < RECENT_EVENTS_LIMIT + 3; i += 1) {
      await insertEvent(database, new Date(future + i * 60_000), { type: "user", id: user });
    }
    const events = await recentActivity(database);
    expect(events).toHaveLength(RECENT_EVENTS_LIMIT);
    const times = events.map((event) => event.occurredAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(events[0]?.occurredAt).toBe(
      new Date(future + (RECENT_EVENTS_LIMIT + 2) * 60_000).toISOString(),
    );
    expect(events[0]?.actor).toEqual({ kind: "user", name: "Test Overview" });
  });

  it("names the actor eduLIMS, before sign-in or a removed account", async () => {
    const database = await testDb();
    const future = NOW.getTime() + 2_000 * HOUR;
    await insertEvent(database, new Date(future), { type: "system" }, "sys_retention_prune");
    await insertEvent(
      database,
      new Date(future + 60_000),
      { type: "anonymous" },
      "authn_login_fail",
    );
    await insertEvent(database, new Date(future + 120_000), { type: "user", id: randomUUID() });
    const [removed, anonymous, system] = await recentActivity(database);
    expect(removed?.actor).toEqual({ kind: "user", name: null });
    expect(anonymous?.actor).toEqual({ kind: "anonymous" });
    expect(system?.actor).toEqual({ kind: "system" });
  });
});

describe("readAdminOverview (#36)", () => {
  it.each([
    ["a student", ["student"]],
    ["a teacher", ["teacher"]],
    ["a user without a role", []],
  ] as const)("refuses %s with 403", async (_name, roles) => {
    const database = await testDb();
    const error: unknown = await readAdminOverview(
      { db: database, actor: { roles: [...roles] } },
      NOW,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 403 });
  });

  it("answers a teacher-administrator, with the instant of the read", async () => {
    const database = await testDb();
    const overview = await readAdminOverview(
      { db: database, actor: { roles: ["teacher", "admin"] } },
      NOW,
    );
    expect(overview.readAt).toBe(NOW.toISOString());
    expect(overview.activity.length).toBeLessThanOrEqual(RECENT_EVENTS_LIMIT);
  });

  // NOTE: the requirements' performance criterion and #36: the overview loads within 2 s with
  // the seeded data; the database read is the part of that load this test can time.
  it("reads the seeded demo set within 2 seconds", async () => {
    const database = await testDb();
    expect(await seedDemoData(database, NOW)).toBe(true);
    const start = performance.now();
    const overview = await readAdminOverview({ db: database, actor: ADMIN }, NOW);
    const elapsed = performance.now() - start;
    expect(overview.counts.students).toBeGreaterThanOrEqual(60);
    expect(overview.activity).toHaveLength(RECENT_EVENTS_LIMIT);
    expect(elapsed).toBeLessThan(2_000);
  });
});
