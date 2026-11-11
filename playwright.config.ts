// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from "@playwright/test";
import { runDatabaseUrl, runPort } from "./tests/e2e/run-env.ts";

// E2E runs the production build (`pnpm build` first) against a database of its own on a port
// of its own, so two runs on one machine never meet. The database is created next to
// E2E_BASE_DATABASE_URL's (CI: the service container; locally: `edulims_e2e` of the dev stack,
// `pnpm dev:db`), migrated and seeded before the app starts, and dropped after the last spec.
// `pnpm db:reset` refuses anything but localhost.
const PORT = await runPort("EDULIMS_E2E_PORT");
const baseURL = `http://localhost:${PORT}`;
const baseDatabaseUrl =
  process.env["E2E_DATABASE_URL"]?.trim() ||
  "postgres://edulims:edulims@127.0.0.1:5432/edulims_e2e";
const databaseUrl = runDatabaseUrl(baseDatabaseUrl);

// Read by the specs (appUrl) and by global-teardown.ts, in the runner and in every worker.
process.env["EDULIMS_E2E_BASE_URL"] = baseURL;
process.env["EDULIMS_E2E_BASE_DATABASE_URL"] = baseDatabaseUrl;
process.env["EDULIMS_E2E_DATABASE_URL"] = databaseUrl;

const appEnv = {
  NODE_ENV: "test",
  PORT: String(PORT),
  DATABASE_URL: databaseUrl,
  E2E_BASE_DATABASE_URL: baseDatabaseUrl,
  BETTER_AUTH_SECRET: "e2e-only-secret-not-for-production-use-0123456789",
  BETTER_AUTH_URL: baseURL,
  // A public e2e-only key: 32 bytes, base64. `pnpm db:seed` registers the dev Keycloak with it
  // when Keycloak runs (pnpm dev:db); without it the providers are skipped (CI).
  EDULIMS_DATA_KEY: "ZWR1bGltcy1lMmUtZGF0YS1rZXktMDEyMzQ1Njc4OTA=",
  EDULIMS_IDP_PRIVATE_ORIGINS:
    process.env["EDULIMS_E2E_KEYCLOAK_ORIGIN"] ?? "http://localhost:8180",
  FERROEHR_BASE_URL: "http://localhost:4001",
  FERROBRIDGE_BASE_URL: "http://localhost:4002",
  EDULIMS_DEV_LOGIN: "true",
};

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, locale: "en-US", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalTeardown: "./tests/e2e/global-teardown.ts",
  webServer: {
    // tests/e2e/seed-providers.ts stores the dev Keycloak providers when no Keycloak runs (CI).
    command:
      "node src/server/db/test-run-database-cli.ts create && pnpm db:reset && node tests/e2e/seed-providers.ts && pnpm start",
    url: `${baseURL}/api/ready`,
    env: appEnv,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
