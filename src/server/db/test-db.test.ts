// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The database test helper itself (#51, #69): one pinned connection, no busy-client queueing,
// every write rolled back, and a database of this run only.
import { type Kysely, sql } from "kysely";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "./schema.gen.ts";
import { baseTestDatabaseUrl, createTestDb, pinnedClient, testDatabaseUrl } from "./test-db.ts";
import { databaseOf, runDatabaseCreatedAt } from "./test-run-database.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

const pgSleep = (database: Kysely<DB>, seconds: number) =>
  sql<{ n: number }>`select ${seconds}::int as n from pg_sleep(${seconds / 100})`.execute(database);

describe("createTestDb", () => {
  it("runs queries started together one after the other on its one connection", async () => {
    db = await createTestDb();
    const database = db;
    const results = await Promise.all([1, 2, 3, 4].map((n) => pgSleep(database, n)));
    expect(results.map((r) => r.rows[0]?.n)).toEqual([1, 2, 3, 4]);
    // The pg deprecation check of test-pg-warnings.ts fails this test if one queued on pg.
  });

  it("passes queries started together to PostgreSQL in order and hands each caller its own error", async () => {
    db = await createTestDb();
    const database = db;
    const [failed, after] = await Promise.allSettled([
      sql`select * from no_such_table`.execute(database),
      sql<{ one: number }>`select 1 as one`.execute(database),
    ]);
    expect(failed.status).toBe("rejected");
    // The failed statement aborted the test transaction, so the next one is refused as well:
    // the helper passed both to PostgreSQL in order and swallowed neither error.
    expect(after.status).toBe("rejected");
  });

  it("lets the rollback wait for the queries still queued or running (#51)", async () => {
    const client = new Client({ connectionString: testDatabaseUrl() });
    await client.connect();
    try {
      const pinned = pinnedClient(client);
      const started = [5, 6, 7].map((n) =>
        pinned.query<{ n: number }>("select $1::int as n from pg_sleep(0.05)", [n]),
      );
      await pinned.idle();
      // pg warns when query() queues behind a running one; the warning check fails this test.
      await client.query("select 1");
      const rows = await Promise.all(started);
      expect(rows.map((r) => r.rows)).toEqual([[{ n: 5 }], [{ n: 6 }], [{ n: 7 }]]);
    } finally {
      await client.end();
    }
  });

  it("releases its connection and the test lock on destroy, even when no query ran", async () => {
    const idle = await createTestDb();
    await idle.destroy();
    // A held lock would block this second instance until the test times out.
    db = await createTestDb();
    const result = await sql<{ one: number }>`select 1 as one`.execute(db);
    expect(result.rows).toEqual([{ one: 1 }]);
  });

  it("rolls back what a test wrote", async () => {
    const first = await createTestDb();
    await first
      .insertInto("user")
      .values({ id: "u-rollback", name: "R", email: "rollback@example.test", emailVerified: true })
      .execute();
    await first.destroy();
    db = await createTestDb();
    const row = await db
      .selectFrom("user")
      .select("id")
      .where("id", "=", "u-rollback")
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });
});

describe("the run database", () => {
  it("is a database of this run, created next to the base database", () => {
    const base = databaseOf(baseTestDatabaseUrl());
    const run = databaseOf(testDatabaseUrl());
    expect(run).not.toBe(base);
    expect(runDatabaseCreatedAt(base, run)).toBeInstanceOf(Date);
  });

  it("is the database the test connection is on", async () => {
    db = await createTestDb();
    const { rows } = await sql<{ name: string }>`select current_database() as name`.execute(db);
    expect(rows).toEqual([{ name: databaseOf(testDatabaseUrl()) }]);
  });
});
