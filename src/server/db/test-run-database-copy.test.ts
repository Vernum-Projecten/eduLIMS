// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The per-worker copies of a test run database (#320), against the dev stack's server.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { baseTestDatabaseUrl, testDatabaseUrl } from "./test-db.ts";
import { createRunDatabase, databaseOf, dropRunDatabase, newRunId } from "./test-run-database.ts";

async function tables(url: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables " +
        "WHERE table_schema = current_schema() ORDER BY table_name",
    );
    return rows.map((row) => row.name);
  } finally {
    await client.end();
  }
}

describe("a copy of a run database (#320)", () => {
  it("holds the migrated schema of the run database it copies", async () => {
    const baseUrl = baseTestDatabaseUrl();
    // This worker's database is a migrated run database, and no session is on it between cases.
    const source = testDatabaseUrl();
    const copyUrl = await createRunDatabase(baseUrl, newRunId(), databaseOf(source));
    try {
      const copied = await tables(copyUrl);
      expect(copied).toContain("user");
      expect(copied).toEqual(await tables(source));
    } finally {
      await dropRunDatabase(baseUrl, copyUrl);
    }
  });

  it("refuses to copy a database that is not a run database", async () => {
    const baseUrl = baseTestDatabaseUrl();
    await expect(createRunDatabase(baseUrl, newRunId(), "edulims")).rejects.toThrow(
      "Refusing to copy edulims: it is not a run database of",
    );
  });

  it("gives each worker of this run a database of its own", () => {
    expect(databaseOf(testDatabaseUrl())).toMatch(/_test_[0-9a-z]{1,10}_[0-9a-f]{6}$/);
  });
});
