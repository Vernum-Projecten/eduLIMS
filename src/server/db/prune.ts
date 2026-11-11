// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// CLI: `pnpm db:prune`. Applies the retention periods (src/server/audit/retention.ts) to the
// database DATABASE_URL names; run it daily (docs/deployment.md). Prints counts only.
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { pruneRetention } from "../audit/retention.ts";
import { envFields, parseWith } from "../env.ts";
import type { DB } from "./schema.gen.ts";

const { DATABASE_URL } = parseWith(envFields.pick({ DATABASE_URL: true }), process.env);
const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString: DATABASE_URL, max: 1 }) }),
});

try {
  const { auditEvents, sessions } = await pruneRetention(db, new Date());
  process.stdout.write(
    `Pruned ${auditEvents} activity-log events and ${sessions} ended sessions.\n`,
  );
} catch (error) {
  console.error("Prune failed:", error);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
