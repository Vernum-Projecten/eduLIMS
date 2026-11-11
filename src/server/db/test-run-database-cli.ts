// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// CLI for the e2e run (playwright.config.ts): `create` makes the run database DATABASE_URL names
// next to the database E2E_BASE_DATABASE_URL names, after dropping stale run databases. Both URLs
// come from the environment, so no password shows in a process list. global-teardown.ts drops it.
import { assertResettable } from "./clear.ts";
import { createRunDatabase, databaseOf } from "./test-run-database.ts";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

const command = process.argv[2];
const baseUrl = required("E2E_BASE_DATABASE_URL");
const runUrl = required("DATABASE_URL");
assertResettable({ NODE_ENV: "test", DATABASE_URL: runUrl });

if (command === "create") {
  const base = databaseOf(baseUrl);
  const runId = databaseOf(runUrl).slice(base.length + 1);
  const created = await createRunDatabase(baseUrl, runId);
  if (databaseOf(created) !== databaseOf(runUrl)) {
    throw new Error(`Created ${databaseOf(created)}, expected ${databaseOf(runUrl)}.`);
  }
  process.stdout.write(`Created the e2e run database ${databaseOf(created)}.\n`);
} else {
  throw new Error(`Usage: test-run-database-cli.ts create (got ${command ?? "nothing"}).`);
}
