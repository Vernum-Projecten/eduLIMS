// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Removing a run database against the dev stack's server (#199): the forced removal refused
// with "permission denied to terminate process" when a session the test role may not end was
// on the database. These cases hold such sessions and prove the removal still succeeds.
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { baseTestDatabaseUrl } from "./test-db.ts";
import { createRunDatabase, databaseOf, dropRunDatabase, newRunId } from "./test-run-database.ts";

const AUTOVACUUM_WAIT_MS = 150_000;

const open: pg.Client[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((client) => client.end().catch(() => undefined)));
});

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  // The removal ends this session on purpose; its error event must not fail the run.
  client.on("error", () => undefined);
  await client.connect();
  open.push(client);
  return client;
}

async function exists(baseUrl: string, name: string): Promise<boolean> {
  const client = await connect(baseUrl);
  const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  return rows.length === 1;
}

describe("dropRunDatabase (#199)", () => {
  it("gives PUBLIC no CONNECT, so no other login role can hold a session", async () => {
    const baseUrl = baseTestDatabaseUrl();
    const runUrl = await createRunDatabase(baseUrl, newRunId());
    try {
      const client = await connect(baseUrl);
      const { rows } = await client.query<{ can: boolean }>(
        "SELECT has_database_privilege('public', $1, 'CONNECT') AS can",
        [databaseOf(runUrl)],
      );
      expect(rows).toEqual([{ can: false }]);
    } finally {
      await dropRunDatabase(baseUrl, runUrl);
    }
  });

  it("ends the test role's own session on the database and removes it", async () => {
    const baseUrl = baseTestDatabaseUrl();
    const runUrl = await createRunDatabase(baseUrl, newRunId());
    await connect(runUrl);
    await dropRunDatabase(baseUrl, runUrl);
    expect(await exists(baseUrl, databaseOf(runUrl))).toBe(false);
  });

  it("removes the database while an autovacuum worker, which has no role, is on it", async () => {
    const baseUrl = baseTestDatabaseUrl();
    const runUrl = await createRunDatabase(baseUrl, newRunId());
    const name = databaseOf(runUrl);
    try {
      const owner = await connect(runUrl);
      // A throttled vacuum keeps the worker on the database until the removal signals it.
      await owner.query(
        "CREATE TABLE filler (id int) WITH (autovacuum_vacuum_insert_threshold = 1, " +
          "autovacuum_vacuum_insert_scale_factor = 0, autovacuum_vacuum_cost_delay = 100, " +
          "autovacuum_vacuum_cost_limit = 1)",
      );
      await owner.query("INSERT INTO filler SELECT g FROM generate_series(1, 100000) g");
      await owner.end();
      const watcher = await connect(baseUrl);
      const deadline = Date.now() + AUTOVACUUM_WAIT_MS;
      let roleless = 0;
      while (roleless === 0 && Date.now() < deadline) {
        // A role without pg_read_all_stats sees the worker's database but not its backend_type;
        // a session with no role is a background worker, never a client.
        const { rows } = await watcher.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND usesysid IS NULL",
          [name],
        );
        roleless = rows[0]?.n ?? 0;
        if (roleless === 0) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(roleless).toBeGreaterThan(0);
      await dropRunDatabase(baseUrl, runUrl);
      expect(await exists(baseUrl, name)).toBe(false);
    } finally {
      await dropRunDatabase(baseUrl, runUrl);
    }
  }, 180_000);
});
