// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// `prune` of the host CLI (src/server/cli.ts): the same prune the app container runs every 24
// hours (src/server/audit/prune-job.ts), by hand, in the database DATABASE_URL names. Prints
// counts only.
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { recordPruneFailure, runPrune } from "../audit/prune-job.ts";
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
    const outcome = await runPrune(db, new Date());
    if (outcome.kind === "locked") {
      out("Another prune is running; this one removed nothing.");
      return 0;
    }
    const { auditEvents, sessions, adminGrants } = outcome.counts;
    out(
      `Pruned ${auditEvents} activity-log events, ${sessions} ended sessions and ` +
        `${adminGrants} expired admin grants.`,
    );
    return 0;
  } catch (error) {
    await recordPruneFailure(db, error);
    return 1;
  } finally {
    await db.destroy();
  }
}
