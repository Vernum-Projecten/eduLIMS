// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// In-process PostgreSQL (PGlite) for tests: real Postgres semantics without Docker.
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect } from "kysely";
import { createMigrator } from "./index.ts";
import type { DB } from "./schema.gen.ts";

export async function createTestDb(options: { migrate?: boolean } = {}): Promise<Kysely<DB>> {
  const db = new Kysely<DB>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  if (options.migrate ?? true) {
    const { error } = await createMigrator(db).migrateToLatest();
    if (error) throw error;
  }
  return db;
}
