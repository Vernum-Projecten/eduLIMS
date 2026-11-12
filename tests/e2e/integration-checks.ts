// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The stored integration checks of this run's database (B3, #227). They are global rows, so a
// journey that asserts "never succeeded" first empties them: a check another journey answered
// earlier in the run (a retry, `--repeat-each`) would otherwise stay as the last success.
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../src/server/db/schema.gen.ts";

/** Deletes every stored integration check, as on a fresh install before the first check. */
export async function clearIntegrationChecks(): Promise<void> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
  try {
    await db.deleteFrom("integration_checks").execute();
  } finally {
    await db.destroy();
  }
}
