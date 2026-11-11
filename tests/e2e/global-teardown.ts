// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Drops this run's database after the last spec. A run that crashes before it gets here leaves
// the database behind, and the next run drops it once it is older than STALE_RUN_DATABASE_MS.
import { dropRunDatabase } from "../../src/server/db/test-run-database.ts";

/** Playwright calls this once after all specs, before it stops the web server. */
export default async function globalTeardown(): Promise<void> {
  const baseUrl = process.env["EDULIMS_E2E_BASE_DATABASE_URL"];
  const runUrl = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!baseUrl || !runUrl) throw new Error("playwright.config.ts set no e2e run database.");
  await dropRunDatabase(baseUrl, runUrl);
}
