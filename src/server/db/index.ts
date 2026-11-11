// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import "@tanstack/react-start/server-only";
import { Kysely, PostgresDialect } from "kysely";
import { Migrator } from "kysely/migration";
import { Pool } from "pg";
import { getEnv } from "../env.ts";
import { migrationProvider } from "./migrations/index.ts";
import type { DB } from "./schema.gen.ts";

export type Database = Kysely<DB>;

let pool: Pool | undefined;
let db: Database | undefined;

/** Shared connection pool, also handed to better-auth. Created lazily on first use. */
export function getPool(): Pool {
  if (pool === undefined) {
    pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 10 });
    // NOTE: node-postgres docs, "Pool: error". An idle client the server drops (a restart, an
    // administrator's terminate) emits here; unhandled, it crashes the process. The pool replaces it.
    pool.on("error", (error) => {
      console.error("Idle database connection lost:", error.message);
    });
  }
  return pool;
}

/** Typed query builder over the shared pool. */
export function getDb(): Database {
  db ??= new Kysely<DB>({ dialect: new PostgresDialect({ pool: getPool() }) });
  return db;
}

export function createMigrator<T>(database: Kysely<T>): Migrator {
  return new Migrator({ db: database, provider: migrationProvider });
}

/** Cheap connectivity probe for the readiness endpoint. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await getPool().query("select 1");
    return true;
  } catch {
    return false;
  }
}
