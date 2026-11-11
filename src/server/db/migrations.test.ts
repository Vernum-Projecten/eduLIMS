// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { getMigrations } from "better-auth/db/migration";
import type { Kysely } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { createAuth } from "../auth.ts";
import { parseEnv } from "../env.ts";
import { VALID_ENV } from "../test-env.ts";
import { createMigrator } from "./index.ts";
import type { DB } from "./schema.gen.ts";
import { createTestDb } from "./test-db.ts";

let db: Kysely<DB> | undefined;

afterEach(async () => {
  await db?.destroy();
  db = undefined;
});

describe("migrations", () => {
  it("match the schema better-auth expects (no drift)", async () => {
    db = await createTestDb();
    const auth = createAuth(parseEnv(VALID_ENV), { db, type: "postgres" });
    const plan = await getMigrations(auth.options);
    // On failure this prints the SQL to add as a new migration.
    const sql = await plan.compileMigrations();
    expect(sql.trim(), sql).toBe(";");
    expect(plan.schemaProblems).toEqual([]);
  });

  it("migrate down to an empty schema and back up again", async () => {
    db = await createTestDb();
    const migrator = createMigrator(db);
    const down = await migrator.migrateDown();
    expect(down.error).toBeUndefined();
    const tables = await db.introspection.getTables();
    expect(tables.map((t) => t.name)).toEqual([]);
    const up = await migrator.migrateToLatest();
    expect(up.results?.map((r) => r.status)).toEqual(["Success"]);
  });
});
