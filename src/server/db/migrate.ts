// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// `migrate` of the host CLI (src/server/cli.ts): `migrate` (latest) or `migrate down` (revert
// one step). Only needs DATABASE_URL; runs on plain Node (type stripping), also in the tools
// image.
import { Kysely, PostgresDialect } from "kysely";
import type { MigrationResultSet } from "kysely/migration";
import { Pool } from "pg";
import { z } from "zod";
import { databaseTlsProblem, envFields, parseWith } from "../env.ts";
import { createMigrator } from "./index.ts";

/** Prints one line of the CLI's output. */
export type Out = (line: string) => void;

function report({ error, results }: MigrationResultSet, out: Out): number {
  for (const result of results ?? []) {
    const line = `${result.direction} ${result.migrationName}: ${result.status}`;
    if (result.status === "Error") console.error(line);
    else out(line);
  }
  if (results?.length === 0) out("No migrations to run.");
  if (error) {
    console.error("Migration failed:", error);
    return 1;
  }
  return 0;
}

const migrateArgs = z.tuple([z.enum(["up", "down"]).optional()]);

/** Runs the migrations up to the latest, or one step down; returns the exit code. */
export async function migrateCommand(args: readonly string[], out: Out): Promise<number> {
  const parsed = migrateArgs.safeParse([...args]);
  if (!parsed.success) {
    out("usage: migrate [up|down]");
    return 2;
  }
  const { DATABASE_URL } = parseWith(envFields.pick({ DATABASE_URL: true }), process.env);
  // Only an explicit NODE_ENV=production (the tools image) checks TLS: `pnpm db:migrate` on a
  // developer machine runs without NODE_ENV against the plain dev database.
  const tlsProblem =
    process.env["NODE_ENV"] === "production" ? databaseTlsProblem(DATABASE_URL) : undefined;
  if (tlsProblem) {
    console.error(`Invalid environment configuration:\nDATABASE_URL ${tlsProblem}`);
    return 1;
  }
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: DATABASE_URL, max: 1 }) }),
  });
  try {
    const migrator = createMigrator(db);
    const down = parsed.data[0] === "down";
    return report(down ? await migrator.migrateDown() : await migrator.migrateToLatest(), out);
  } finally {
    await db.destroy();
  }
}
