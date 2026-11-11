// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from "@playwright/test";

// E2E runs the production build (`pnpm build` first) against a throwaway PostgreSQL 18
// database: E2E_DATABASE_URL when given (the CI service container), otherwise the
// `edulims_e2e` database of the dev stack (`pnpm dev:db`). `pnpm db:reset` empties,
// migrates and seeds it before the app starts; it refuses anything but localhost.
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
const databaseUrl =
  process.env["E2E_DATABASE_URL"]?.trim() ||
  "postgres://edulims:edulims@127.0.0.1:5432/edulims_e2e";

const appEnv = {
  NODE_ENV: "test",
  PORT: String(PORT),
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: "e2e-only-secret-not-for-production-use-0123456789",
  BETTER_AUTH_URL: baseURL,
  MICROSOFT_CLIENT_ID: "00000000-0000-0000-0000-000000000001",
  MICROSOFT_CLIENT_SECRET: "e2e-dummy",
  MICROSOFT_TENANT_ID: "00000000-0000-0000-0000-000000000002",
  // Unreachable on purpose: the button renders; discovery is never needed by the tests.
  KEYCLOAK_ISSUER: "http://127.0.0.1:9/realms/edulims",
  KEYCLOAK_CLIENT_ID: "edulims-e2e",
  KEYCLOAK_CLIENT_SECRET: "e2e-dummy",
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
  webServer: {
    command: "pnpm db:reset && pnpm start",
    url: `${baseURL}/api/ready`,
    env: appEnv,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
