// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One retention prune (B4, #65) on a real PostgreSQL 18: the deletes, the activity-log row, the
// advisory lock that keeps a second runner out, and a failure that is logged, not thrown.
import { type Kysely, sql } from "kysely";
import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RETENTION_PRUNE_LOCK_KEY } from "../db/advisory-locks.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb, testDatabaseUrl } from "../db/test-db.ts";
import { setSecurityLogWriter } from "../security-log.ts";
import { runPrune, runScheduledPrune } from "./prune-job.ts";
import { recordAudit } from "./record.ts";

let db: Kysely<DB> | undefined;
let other: Client | undefined;
let restoreLog: (() => void) | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
  await other?.end();
  other = undefined;
  vi.restoreAllMocks();
  restoreLog?.();
  restoreLog = undefined;
});

const NOW = new Date("2026-11-11T03:00:00Z");

async function setup(): Promise<Kysely<DB>> {
  const database = await createTestDb();
  db = database;
  for (const [id, occurredAt] of [
    ["old", "2025-11-01T00:00:00Z"],
    ["new", "2026-11-01T00:00:00Z"],
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
    .values({ id: "u1", name: "Prune Person", email: "p@example.test", emailVerified: true })
    .execute();
  await database
    .insertInto("session")
    .values({
      id: "s-old",
      token: "t-old",
      userId: "u1",
      expiresAt: "2026-09-01T00:00:00Z",
      updatedAt: NOW,
    })
    .execute();
  return database;
}

async function pruneRows(database: Kysely<DB>) {
  return database
    .selectFrom("audit_event")
    .select(["actor_type", "actor_id", "outcome", "target_type", "reason_code", "metadata"])
    .where("action", "=", "sys_retention_prune")
    .execute();
}

describe("runPrune (B4, #65)", () => {
  it("removes expired rows and writes a system row with the counts only", async () => {
    const database = await setup();
    const lines: string[] = [];
    restoreLog = setSecurityLogWriter((line) => lines.push(line));
    expect(await runPrune(database, NOW)).toEqual({
      kind: "pruned",
      counts: { auditEvents: 1, sessions: 1, adminGrants: 0 },
    });
    expect(await pruneRows(database)).toEqual([
      {
        actor_type: "system",
        actor_id: null,
        outcome: "success",
        target_type: null,
        reason_code: null,
        metadata: { removed_audit_events: 1, removed_sessions: 1, removed_admin_grants: 0 },
      },
    ]);
    const streamed = lines.filter((line) => line.includes("sys_retention_prune"));
    expect(streamed).toHaveLength(1);
    expect(JSON.parse(streamed[0] ?? "null")).toMatchObject({
      event: "sys_retention_prune",
      actor_type: "system",
      removed_audit_events: 1,
      removed_sessions: 1,
      removed_admin_grants: 0,
    });
  });

  it("skips while another runner holds the lock, so a second replica removes nothing", async () => {
    const database = await setup();
    other = new Client({ connectionString: testDatabaseUrl() });
    await other.connect();
    await other.query("begin");
    await other.query("select pg_advisory_xact_lock($1)", [RETENTION_PRUNE_LOCK_KEY]);
    expect(await runPrune(database, NOW)).toEqual({ kind: "locked" });
    const left = await database.selectFrom("audit_event").select("actor_id").execute();
    expect(left.map((e) => e.actor_id).sort()).toEqual(["new", "old"]);
    expect(await pruneRows(database)).toEqual([]);
    await other.query("rollback");
    expect(await runPrune(database, NOW)).toMatchObject({ kind: "pruned" });
  });
});

describe("runScheduledPrune (#65)", () => {
  it("logs a failure with its cause and a failure row, without throwing", async () => {
    const database = await setup();
    const lines: string[] = [];
    restoreLog = setSecurityLogWriter((line) => lines.push(line));
    await sql`alter table session rename to session_gone`.execute(database);
    expect(await runScheduledPrune(database, NOW)).toEqual({ kind: "failed" });
    expect(await pruneRows(database)).toEqual([
      expect.objectContaining({ outcome: "failure", reason_code: "prune_failed", metadata: null }),
    ]);
    const left = await database.selectFrom("audit_event").select("actor_id").execute();
    expect(left.map((e) => e.actor_id)).toContain("old");
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      // 42P01 undefined_table: the SQLSTATE, never the message that names the table.
      expect.objectContaining({
        level: "error",
        event: "retention_prune_failed",
        actor_type: "system",
        cause: expect.arrayContaining(["error:42P01"]),
      }),
      expect.objectContaining({
        level: "error",
        event: "sys_retention_prune",
        outcome: "failure",
        reason: "prune_failed",
      }),
    ]);
  });
});
