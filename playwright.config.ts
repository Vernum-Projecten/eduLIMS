// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from "@playwright/test";
import { E2E_SECRETS, runDatabaseUrl, runPort } from "./tests/e2e/run-env.ts";
import { setupThenServe } from "./tests/e2e/web-server-command.ts";

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
  BETTER_AUTH_SECRET: E2E_SECRETS.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: baseURL,
  // `pnpm db:seed` registers the dev Keycloak with this key when Keycloak runs (pnpm dev:db);
  // without it the providers are skipped (CI).
  EDULIMS_DATA_KEY: E2E_SECRETS.EDULIMS_DATA_KEY,
  EDULIMS_IDP_PRIVATE_ORIGINS:
    process.env["EDULIMS_E2E_KEYCLOAK_ORIGIN"] ?? "http://localhost:8180",
  FERROEHR_BASE_URL: "http://localhost:4001",
  FERROEHR_TOKEN_URL: "http://localhost:4003/token",
  FERROEHR_CLIENT_ID: "edulims-ferroehr",
  FERROEHR_CLIENT_SECRET: "e2e-only-ferroehr-client-secret",
  FERROEHR_SCOPE: "system/template-*.cr",
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
    // The setup's stdout, the seed's summary among it, reaches the run log (#192).
    command: setupThenServe(
      [
        "node src/server/db/test-run-database-cli.ts create",
        "pnpm db:reset",
        "node tests/e2e/seed-providers.ts",
      ],
      "pnpm start",
    ),
    url: `${baseURL}/api/ready`,
    env: appEnv,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
