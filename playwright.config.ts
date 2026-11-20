// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from "@playwright/test";
import {
  DEFAULT_E2E_DATABASE_URL,
  E2E_SECRETS,
  keycloakOrigin,
  runDatabaseUrl,
  runOutputDir,
  runPort,
} from "./tests/e2e/run-env.ts";
import { setupThenServe, webServerTimeout } from "./tests/e2e/web-server-command.ts";

// E2E runs the production build (`pnpm build` first) against a database of its own on a port
// of its own, so two runs on one machine never meet. The database is created next to
// E2E_BASE_DATABASE_URL's (CI: the service container; locally: `edulims_e2e` of the dev stack,
// `pnpm dev:db`), migrated and seeded before the app starts, and dropped after the last spec.
// `pnpm db:reset` refuses anything but localhost.
const PORT = await runPort("EDULIMS_E2E_PORT");
const baseURL = `http://localhost:${PORT}`;
const INTEGRATIONS = `http://127.0.0.1:${await runPort("EDULIMS_E2E_INTEGRATIONS_PORT")}`;
const baseDatabaseUrl = process.env["E2E_DATABASE_URL"]?.trim() || DEFAULT_E2E_DATABASE_URL;
const databaseUrl = runDatabaseUrl(baseDatabaseUrl);
const INTEGRATION_STATUS_SPEC = /admin-integrations\.spec\.ts$/;
const SCIM_SPEC = /admin-scim\.spec\.ts$/;

// The web server's setup, each step with its own bound (#248). Measured on CI and on a loaded
// developer machine (load average 10 on 18 cores): the run database 1 to 1.5 s, `pnpm db:reset`
// 15 to 19 s on CI and 35 s loaded, the providers under 3 s, the start to /api/ready 12.5 s
// loaded. Each bound is about 2.5 times the slowest measurement or more.
// tests/e2e/seed-providers.ts stores the dev Keycloak providers when no Keycloak runs (CI).
const SETUP_STEPS = [
  { command: "node src/server/db/test-run-database-cli.ts create", timeoutMs: 15_000 },
  { command: "pnpm db:reset", timeoutMs: 90_000 },
  { command: "node tests/e2e/seed-providers.ts", timeoutMs: 15_000 },
] as const;
const START_TIMEOUT_MS = 45_000;

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
  EDULIMS_IDP_PRIVATE_ORIGINS: keycloakOrigin(),
  // Nothing listens on this run's integration port, except while the integration status journey
  // runs its stub there (tests/e2e/integration-stub.ts, #227).
  FERROEHR_BASE_URL: `${INTEGRATIONS}/ferroehr/rest/openehr/v1`,
  FERROEHR_TOKEN_URL: `${INTEGRATIONS}/token`,
  FERROEHR_CLIENT_ID: "edulims-ferroehr",
  FERROEHR_CLIENT_SECRET: "e2e-only-ferroehr-client-secret",
  FERROEHR_SCOPE: "system/template-*.r system/composition-*.cr",
  FERROEHR_FACILITY_ISSUER: "urn:example:edulims-e2e-facility",
  FERROEHR_FACILITY_ID: "e2e-lab",
  FERROEHR_TERRITORY: "NL",
  FERROBRIDGE_BASE_URL: `${INTEGRATIONS}/ferrobridge`,
  EDULIMS_DEV_LOGIN: "true",
};

export default defineConfig({
  testDir: "tests/e2e",
  // Playwright empties its output folder at the start, so each run writes to its own (#321).
  outputDir: runOutputDir(),
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  // A trace of every test made the longest journeys 3 to 4 times slower on a loaded host (5.0 s
  // untraced, 22.7 s traced) and left their context teardown, which writes the trace, past the
  // 30 s budget (#321). The first retry records one; locally, run with `--trace on`.
  use: { baseURL, locale: "en-US", trace: "on-first-retry" },
  // The integration status journeys own this run's integration port and the global check rows,
  // so one worker runs them: a retry or a repeat of the file never overlaps another (#227).
  // The SCIM journey owns the one token of the keycloak provider in the same way (#321).
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [INTEGRATION_STATUS_SPEC, SCIM_SPEC],
    },
    {
      name: "chromium-integration-status",
      use: { ...devices["Desktop Chrome"] },
      testMatch: INTEGRATION_STATUS_SPEC,
      workers: 1,
    },
    {
      name: "chromium-scim",
      use: { ...devices["Desktop Chrome"] },
      testMatch: SCIM_SPEC,
      workers: 1,
    },
  ],
  globalTeardown: "./tests/e2e/global-teardown.ts",
  webServer: {
    // The setup's stdout, the seed's summary among it, reaches the run log (#192), with each
    // step's time; a step past its bound stops the run naming it (#248).
    command: setupThenServe(SETUP_STEPS, "pnpm start"),
    url: `${baseURL}/api/ready`,
    env: appEnv,
    reuseExistingServer: false,
    timeout: webServerTimeout(SETUP_STEPS, START_TIMEOUT_MS),
  },
});
