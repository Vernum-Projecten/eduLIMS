// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// `migrate` of the host CLI (src/server/cli.ts): `migrate` (latest) or `migrate down` (revert
// one step). Only needs DATABASE_URL; runs on plain Node (type stripping), also in the tools
// image. A failure goes to the security log stream as `migration_failed`, with error classes and
// SQLSTATE codes, never a message.
import { Kysely, PostgresDialect } from "kysely";
import type { MigrationResultSet } from "kysely/migration";
import { Pool } from "pg";
import { z } from "zod";
import { databaseTlsProblem, envFields, parseWith } from "../env.ts";
import { logFailure, logSecurityEvent } from "../security-log.ts";
import { createMigrator } from "./index.ts";

/** Prints one line of the CLI's output. */
export type Out = (line: string) => void;

/** The security-log event of a failed `migrate`. */
export const MIGRATION_FAILED_EVENT = "migration_failed";

type Direction = "up" | "down";

function report({ error, results }: MigrationResultSet, direction: Direction, out: Out): number {
  for (const result of results ?? []) {
    out(`${result.direction} ${result.migrationName}: ${result.status}`);
  }
  if (results?.length === 0) out("No migrations to run.");
  if (error) {
    const failed = results?.find((result) => result.status === "Error");
    logFailure(MIGRATION_FAILED_EVENT, error, {
      actor_type: "system",
      direction,
      migration: failed?.migrationName,
    });
    out(`Migration failed; the ${MIGRATION_FAILED_EVENT} log line names its cause.`);
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
    logSecurityEvent("error", MIGRATION_FAILED_EVENT, {
      actor_type: "system",
      reason: "database_tls_required",
      variables: ["DATABASE_URL"],
    });
    out(`Invalid environment configuration: DATABASE_URL ${tlsProblem}`);
    return 1;
  }
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: DATABASE_URL, max: 1 }) }),
  });
  try {
    const migrator = createMigrator(db);
    const direction: Direction = parsed.data[0] ?? "up";
    const result =
      direction === "down" ? await migrator.migrateDown() : await migrator.migrateToLatest();
    return report(result, direction, out);
  } finally {
    await db.destroy();
  }
}
