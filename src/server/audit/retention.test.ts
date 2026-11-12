// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { recordAudit } from "./record.ts";
import { pruneRetention } from "./retention.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

const NOW = new Date("2026-11-11T03:00:00Z");

async function seed(database: Kysely<DB>) {
  for (const [id, occurredAt] of [
    ["old", "2025-11-11T02:59:59Z"],
    ["edge", "2025-11-11T03:00:00Z"],
    ["new", "2026-11-01T03:00:00Z"],
  ] as const) {
    await recordAudit(database, {
      action: "authn_logout",
      actor: { type: "user", id },
      outcome: "success",
      occurredAt: new Date(occurredAt),
    });
  }
  await database
    .insertInto("user")
    .values({ id: "u1", name: "Retention Person", email: "r@example.test", emailVerified: true })
    .execute();
  for (const [id, expiresAt] of [
    ["s-old", "2026-10-12T02:59:59Z"],
    ["s-edge", "2026-10-12T03:00:00Z"],
    ["s-live", "2026-11-20T00:00:00Z"],
  ] as const) {
    await database
      .insertInto("session")
      .values({ id, token: `t-${id}`, userId: "u1", expiresAt, updatedAt: NOW })
      .execute();
  }
}

describe("pruneRetention (owner decision on #32)", () => {
  it("deletes events older than 12 months and sessions expired over 30 days ago", async () => {
    const database = await createTestDb();
    db = database;
    await seed(database);
    expect(await pruneRetention(database, NOW)).toEqual({
      auditEvents: 1,
      sessions: 1,
      invitations: 0,
    });
    const events = await database.selectFrom("audit_event").select("actor_id").execute();
    expect(events.map((e) => e.actor_id).sort()).toEqual(["edge", "new"]);
    const sessions = await database.selectFrom("session").select("id").execute();
    expect(sessions.map((s) => s.id).sort()).toEqual(["s-edge", "s-live"]);
  });

  it("removes nothing on a second run with the same clock", async () => {
    const database = await createTestDb();
    db = database;
    await seed(database);
    await pruneRetention(database, NOW);
    expect(await pruneRetention(database, NOW)).toEqual({
      auditEvents: 0,
      sessions: 0,
      invitations: 0,
    });
  });
});

describe("pruneRetention of class invitations (owner decision on #28 (4))", () => {
  const CLASS_ID = "01960000-0000-7000-8000-000000000001";

  async function invitations(database: Kysely<DB>) {
    await database
      .insertInto("user")
      .values({
        id: "inviter",
        name: "Inviter",
        email: "inviter@example.test",
        emailVerified: true,
      })
      .execute();
    await database
      .insertInto("organization")
      .values({
        id: CLASS_ID,
        slug: CLASS_ID,
        name: "LS-2A",
        academic_year: "2026-2027",
        createdAt: NOW,
      })
      .execute();
    const rows: [string, string, string | null, string][] = [
      // id, status, ended_at, expiresAt
      ["ended-old", "accepted", "2026-08-13T02:59:59Z", "2026-09-01T00:00:00Z"],
      ["ended-edge", "canceled", "2026-08-13T03:00:00Z", "2026-09-01T00:00:00Z"],
      ["expired-old", "pending", null, "2026-08-13T02:59:59Z"],
      ["expired-recent", "pending", null, "2026-11-01T00:00:00Z"],
      ["live", "pending", null, "2026-12-01T00:00:00Z"],
    ];
    for (const [id, status, endedAt, expiresAt] of rows) {
      await database
        .insertInto("invitation")
        .values({
          id,
          organizationId: CLASS_ID,
          email: `${id}@example.test`,
          role: "student",
          status,
          ended_at: endedAt,
          expiresAt,
          createdAt: "2026-08-01T00:00:00Z",
          inviterId: "inviter",
        })
        .execute();
    }
  }

  it("deletes invitations that ended or expired more than 90 days ago", async () => {
    const database = await createTestDb();
    db = database;
    await invitations(database);
    const result = await pruneRetention(database, NOW);
    expect(result.invitations).toBe(2);
    const left = await database.selectFrom("invitation").select("id").orderBy("id").execute();
    expect(left.map((row) => row.id)).toEqual(["ended-edge", "expired-recent", "live"]);
  });
});
