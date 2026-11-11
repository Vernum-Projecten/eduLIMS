// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Vitest global setup: empties the test database and runs the migrations from empty,
// once per run, so every test starts from the schema the migrations build.
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { assertTestDatabase, clearDatabase } from "./clear.ts";
import { createMigrator } from "./index.ts";
import { testDatabaseUrl } from "./test-db.ts";

/** Prepares the test database; Vitest calls it before any test file runs. */
export async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const { host, port, database } = assertTestDatabase(url);
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
  try {
    await clearDatabase(db);
    const { error } = await createMigrator(db).migrateToLatest();
    if (error) throw error;
  } catch (error) {
    throw new Error(
      `The test database ${database} on ${host}:${port} is not ready. Start the dev stack ` +
        "(pnpm dev:db) or set TEST_DATABASE_URL.",
      { cause: error },
    );
  } finally {
    await db.destroy();
  }
}
