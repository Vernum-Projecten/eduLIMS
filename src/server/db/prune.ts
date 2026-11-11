// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// `prune` of the host CLI (src/server/cli.ts): applies the retention periods
// (src/server/audit/retention.ts) and drops expired pending admin grants (#48) in the database
// DATABASE_URL names; run it daily (docs/deployment.md). Prints counts only.
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { pruneExpiredGrants } from "../admin-grant/grants.ts";
import { pruneRetention } from "../audit/retention.ts";
import { envFields, parseWith } from "../env.ts";
import type { Out } from "./migrate.ts";
import type { DB } from "./schema.gen.ts";

/** Prunes the activity log, ended sessions and expired grants; returns the exit code. */
export async function pruneCommand(args: readonly string[], out: Out): Promise<number> {
  if (args.length > 0) {
    out("usage: prune");
    return 2;
  }
  const { DATABASE_URL } = parseWith(envFields.pick({ DATABASE_URL: true }), process.env);
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: DATABASE_URL, max: 1 }) }),
  });
  try {
    const now = new Date();
    const { auditEvents, sessions } = await pruneRetention(db, now);
    const grants = await pruneExpiredGrants(db, now);
    out(
      `Pruned ${auditEvents} activity-log events, ${sessions} ended sessions and ` +
        `${grants} expired admin grants.`,
    );
    return 0;
  } catch (error) {
    console.error("Prune failed:", error);
    return 1;
  } finally {
    await db.destroy();
  }
}
