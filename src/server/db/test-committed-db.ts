// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A database for concurrency tests: createTestDb pins one connection inside one transaction, so
// two transactions never meet there. This creates a migrated database of its own next to the
// run's, with a real pool whose transactions commit and lock, and drops it afterwards.
import { Kysely, PostgresDialect } from "kysely";
import pg, { type Client, Pool } from "pg";
import { createMigrator } from "./index.ts";
import type { DB } from "./schema.gen.ts";
import { baseTestDatabaseUrl } from "./test-db.ts";
import { createRunDatabase, databaseOf, dropRunDatabase, newRunId } from "./test-run-database.ts";

/** A committed test database and the way to drop it. */
export interface CommittedTestDb {
  db: Kysely<DB>;
  /** The pool's own connections, for a test that holds a lock by hand. */
  pool: Pool;
  destroy(): Promise<void>;
}

const SESSION_WAIT_MS = 10_000;

/** Waits until the server holds no session on the database `url` names. */
async function waitForNoSessions(baseUrl: string, url: string): Promise<void> {
  const client = new pg.Client({ connectionString: baseUrl });
  await client.connect();
  try {
    const deadline = Date.now() + SESSION_WAIT_MS;
    for (;;) {
      const { rows } = await client.query<{ n: string }>(
        "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = $1",
        [databaseOf(url)],
      );
      if (rows[0]?.n === "0") return;
      if (Date.now() > deadline) throw new Error(`sessions remain on ${databaseOf(url)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    await client.end();
  }
}

/**
 * Creates and migrates a database of its own, with a pool of `max` connections.
 *
 * `destroy()` drops the database only once every pool client has closed and the server holds no
 * session on it. `pool.end()` resolves while the last clients are still closing; dropping then
 * (`DROP DATABASE … WITH (FORCE)`) ends their backends under them, which raised unhandled
 * `57P01` errors and failed the run on CI's slower runner (#119).
 */
export async function createCommittedTestDb(max = 10): Promise<CommittedTestDb> {
  const baseUrl = baseTestDatabaseUrl();
  const url = await createRunDatabase(baseUrl, newRunId());
  const pool = new Pool({ connectionString: url, max });
  const closed: Promise<void>[] = [];
  pool.on("connect", (client: Client) => {
    closed.push(new Promise((resolve) => client.once("end", () => resolve())));
  });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  const destroy = async () => {
    await db.destroy();
    await Promise.all(closed);
    await waitForNoSessions(baseUrl, url);
    await dropRunDatabase(baseUrl, url);
  };
  try {
    const { error } = await createMigrator(db).migrateToLatest();
    if (error) throw error;
  } catch (error) {
    await destroy();
    throw error;
  }
  return { db, pool, destroy };
}
