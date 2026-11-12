// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A database for concurrency tests: createTestDb pins one connection inside one transaction, so
// two transactions never meet there. This creates a migrated database of its own next to the
// run's, with a real pool whose transactions commit and lock, and drops it afterwards.
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { createMigrator } from "./index.ts";
import type { DB } from "./schema.gen.ts";
import { baseTestDatabaseUrl } from "./test-db.ts";
import { createRunDatabase, dropRunDatabase, newRunId } from "./test-run-database.ts";

/** A committed test database and the way to drop it. */
export interface CommittedTestDb {
  db: Kysely<DB>;
  /** The pool's own connections, for a test that holds a lock by hand. */
  pool: Pool;
  destroy(): Promise<void>;
}

/** Creates and migrates a database of its own, with a pool of `max` connections. */
export async function createCommittedTestDb(max = 20): Promise<CommittedTestDb> {
  const baseUrl = baseTestDatabaseUrl();
  const url = await createRunDatabase(baseUrl, newRunId());
  const pool = new Pool({ connectionString: url, max });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  try {
    const { error } = await createMigrator(db).migrateToLatest();
    if (error) throw error;
  } catch (error) {
    await db.destroy();
    await dropRunDatabase(baseUrl, url);
    throw error;
  }
  return {
    db,
    pool,
    destroy: async () => {
      await db.destroy();
      await dropRunDatabase(baseUrl, url);
    },
  };
}
