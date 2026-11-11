// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// CLI: the first step of `pnpm db:reset`, which then runs `pnpm db:migrate` and
// `pnpm db:seed`. Empties the database DATABASE_URL names, and refuses unless NODE_ENV
// is development or test and the server is on localhost (assertResettable).
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { envFields, parseWith } from "../env.ts";
import { assertResettable, clearDatabase } from "./clear.ts";

const env = parseWith(envFields.pick({ NODE_ENV: true, DATABASE_URL: true }), process.env);
let target: ReturnType<typeof assertResettable>;
try {
  target = assertResettable(env);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

process.stdout.write(
  `Resetting database ${target.database} on ${target.host}:${target.port}: dropping every ` +
    "table, view, sequence, function and type in its schema. Other databases are not touched.\n",
);
const db = new Kysely<unknown>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: env.DATABASE_URL, max: 1 }),
  }),
});
try {
  await clearDatabase(db);
  process.stdout.write("Database emptied; migrating and seeding next.\n");
} finally {
  await db.destroy();
}
