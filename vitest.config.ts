// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [viteReact()],
  test: {
    environment: "node",
    // Creates and migrates this run's own database next to TEST_DATABASE_URL, and drops it after.
    globalSetup: ["src/server/db/test-global-setup.ts"],
    // A pg deprecation warning (a query on a busy client) fails the test it appears in.
    setupFiles: ["src/server/db/test-pg-warnings.ts"],
    // Each worker holds at most one test connection, so a run opens at most 6 plus the global
    // setup's one: 5 parallel runs stay far below the dev server's max_connections of 100.
    maxWorkers: 6,
    // tests/integration skip themselves when the Compose service they need is not reachable.
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      // Unit coverage gates the core logic; routes and components are covered by e2e tests.
      include: ["src/server/**/*.ts", "src/lib/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/test-*.ts",
        "src/server/db/schema.gen.ts",
        // Host CLI commands, exercised by `pnpm db:migrate`, `db:seed`, `db:reset`, `db:prune`,
        // `idp:*`, `scim:*` and e2e setup; the dispatcher (src/server/cli.ts) has its own tests.
        "src/server/db/migrate.ts",
        "src/server/db/seed.ts",
        "src/server/db/reset.ts",
        "src/server/db/prune.ts",
        "src/server/idp/command.ts",
        "src/server/scim/command.ts",
      ],
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
});
