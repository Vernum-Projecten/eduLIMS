// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { getMigrations } from "better-auth/db/migration";
import type { Kysely } from "kysely";
import { NO_MIGRATIONS } from "kysely/migration";
import { afterEach, describe, expect, it } from "vitest";
import { createAuth } from "../auth.ts";
import { parseEnv } from "../env.ts";
import { VALID_ENV } from "../test-env.ts";
import { createMigrator } from "./index.ts";
import { migrations } from "./migrations/index.ts";
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
    const down = await migrator.migrateTo(NO_MIGRATIONS);
    expect(down.error).toBeUndefined();
    const tables = await db.introspection.getTables();
    expect(tables.map((t) => t.name)).toEqual([]);
    const up = await migrator.migrateToLatest();
    expect(up.results?.map((r) => r.status)).toEqual(Object.keys(migrations).map(() => "Success"));
  });

  it("0002_user_locale reverts to a user table without the locale column", async () => {
    db = await createTestDb();
    const migrator = createMigrator(db);
    const down = await migrator.migrateDown();
    expect(down.results?.map((r) => [r.migrationName, r.status])).toEqual([
      ["0002_user_locale", "Success"],
    ]);
    const user = (await db.introspection.getTables()).find((t) => t.name === "user");
    expect(user?.columns.map((c) => c.name)).not.toContain("locale");
    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
  });
});
