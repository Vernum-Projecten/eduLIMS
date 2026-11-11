// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// CLI: `pnpm db:migrate` (latest) or `pnpm db:migrate down` (revert one step).
// Runs on plain Node (native type stripping); only needs DATABASE_URL.
import { Kysely, PostgresDialect } from "kysely";
import type { MigrationResultSet } from "kysely/migration";
import { Pool } from "pg";
import { envFields, parseWith } from "../env.ts";
import { createMigrator } from "./index.ts";

function report({ error, results }: MigrationResultSet): void {
  for (const result of results ?? []) {
    const line = `${result.direction} ${result.migrationName}: ${result.status}`;
    if (result.status === "Error") console.error(line);
    else process.stdout.write(`${line}\n`);
  }
  if (results?.length === 0) process.stdout.write("No migrations to run.\n");
  if (error) {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  }
}

const { DATABASE_URL } = parseWith(envFields.pick({ DATABASE_URL: true }), process.env);
const db = new Kysely<unknown>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString: DATABASE_URL, max: 1 }) }),
});

try {
  const migrator = createMigrator(db);
  report(
    process.argv[2] === "down" ? await migrator.migrateDown() : await migrator.migrateToLatest(),
  );
} finally {
  await db.destroy();
}
