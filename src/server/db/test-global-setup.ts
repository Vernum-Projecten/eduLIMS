// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Vitest global setup: creates this run's own database next to the TEST_DATABASE_URL database,
// runs the migrations from empty once, hands the URL to the tests, and drops it at the end, so
// runs in parallel (worktrees on one machine) never share a schema or a lock.
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";
import { assertTestDatabase } from "./clear.ts";
import { createMigrator } from "./index.ts";
import { baseTestDatabaseUrl } from "./test-db.ts";
import { createRunDatabase, dropRunDatabase, newRunId } from "./test-run-database.ts";

/** Prepares this run's database; Vitest calls it before any test file runs. */
export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const baseUrl = baseTestDatabaseUrl();
  const { host, port, database } = assertTestDatabase(baseUrl);
  let runUrl: string;
  try {
    runUrl = await createRunDatabase(baseUrl, newRunId());
  } catch (error) {
    throw new Error(
      `Cannot create a test run database next to ${database} on ${host}:${port}. Start the dev ` +
        "stack (pnpm dev:db) or set TEST_DATABASE_URL.",
      { cause: error },
    );
  }
  assertTestDatabase(runUrl);
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: runUrl, max: 1 }) }),
  });
  try {
    const { error } = await createMigrator(db).migrateToLatest();
    if (error) throw error;
  } catch (error) {
    await dropRunDatabase(baseUrl, runUrl);
    throw new Error("The migrations fail on an empty test database.", { cause: error });
  } finally {
    await db.destroy();
  }
  project.provide("testDatabaseUrl", runUrl);
  return () => dropRunDatabase(baseUrl, runUrl);
}
