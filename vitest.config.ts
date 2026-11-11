// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [viteReact()],
  test: {
    environment: "node",
    // Clears and migrates the PostgreSQL test database (TEST_DATABASE_URL) once per run.
    globalSetup: ["src/server/db/test-global-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // Unit coverage gates the core logic; routes and components are covered by e2e tests.
      include: ["src/server/**/*.ts", "src/lib/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/test-*.ts",
        "src/server/db/schema.gen.ts",
        // CLI entry points, exercised by `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:reset` and e2e setup.
        "src/server/db/migrate.ts",
        "src/server/db/seed.ts",
        "src/server/db/reset.ts",
      ],
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
});
