// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Vitest global setup: creates this run's own database next to the TEST_DATABASE_URL database,
// runs the migrations from empty once, copies it once per worker, hands the copies to the tests,
// and drops them all at the end, so runs in parallel (worktrees on one machine) never share a
// schema or a lock, and the workers of one run never wait on each other's test lock (#320).
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";
import { assertTestDatabase } from "./clear.ts";
import { createMigrator } from "./index.ts";
import { baseTestDatabaseUrl } from "./test-db.ts";
import { createRunDatabase, databaseOf, dropRunDatabase, newRunId } from "./test-run-database.ts";

/** Prepares this run's databases; Vitest calls it before any test file runs. */
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
  const created = [runUrl];
  const dropAll = async () => {
    for (const url of created) await dropRunDatabase(baseUrl, url);
  };
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: runUrl, max: 1 }) }),
  });
  try {
    const { error } = await createMigrator(db).migrateToLatest();
    if (error) throw error;
  } catch (error) {
    await db.destroy();
    await dropAll();
    throw new Error("The migrations fail on an empty test database.", { cause: error });
  }
  await db.destroy();
  // NOTE: #320; every test holds the database's test lock for its whole transaction, so one
  // database per worker keeps a slow test from making the other workers' tests time out.
  try {
    for (let worker = 0; worker < project.globalConfig.maxWorkers; worker += 1) {
      const copy = await createRunDatabase(baseUrl, newRunId(), databaseOf(runUrl));
      created.push(copy);
      assertTestDatabase(copy);
    }
  } catch (error) {
    await dropAll();
    throw error;
  }
  project.provide("testDatabaseUrls", created.slice(1));
  return dropAll;
}
