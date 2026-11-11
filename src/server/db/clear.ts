// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Emptying a local database for `pnpm db:reset`, the e2e start and the Vitest global
// setup, with the guards that keep it away from anything but a local throwaway database.
import { type Kysely, sql } from "kysely";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Where a reset would land, for the guard's message and the CLI's announcement. */
export interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
}

export function describeDatabase(databaseUrl: string): DatabaseTarget {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

/**
 * Throws unless the database is safe to empty: NODE_ENV is development or test, and
 * the server is on the loopback interface (a developer's own Compose stack or a CI
 * service container), so a production or shared server is never reset.
 */
export function assertResettable(env: {
  NODE_ENV: string | undefined;
  DATABASE_URL: string;
}): DatabaseTarget {
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new Error(
      `Refusing to reset: NODE_ENV is ${env.NODE_ENV ?? "unset"}, not development or test.`,
    );
  }
  const target = describeDatabase(env.DATABASE_URL);
  if (!LOOPBACK_HOSTS.has(target.host)) {
    throw new Error(
      `Refusing to reset: the database host ${target.host} is not localhost, 127.0.0.1 or ::1.`,
    );
  }
  if (target.database === "") {
    throw new Error("Refusing to reset: DATABASE_URL names no database.");
  }
  return target;
}

// A name ending in `_test`, or the run database of one (test-run-database.ts).
const TEST_DATABASE_NAME = /_test(?:_[0-9a-z]{1,10}_[0-9a-f]{6})?$/;

/**
 * Throws unless the URL names a Vitest database: a name ending in `_test`, or the run database
 * `<name>_test_<run id>` that the global setup creates next to it.
 */
export function assertTestDatabase(databaseUrl: string): DatabaseTarget {
  const target = assertResettable({ NODE_ENV: "test", DATABASE_URL: databaseUrl });
  if (!TEST_DATABASE_NAME.test(target.database)) {
    throw new Error(
      `Refusing to run the database tests on "${target.database}": the name must end in _test.`,
    );
  }
  return target;
}

/**
 * Drops every view, table, sequence, function and type in the current schema, the
 * migration bookkeeping included, so the migrations run again from empty. The schema
 * itself stays, and with it its grants and default privileges (the read-only role of
 * compose.dev.yaml keeps reading new tables). Objects an extension owns are left alone.
 */
export async function clearDatabase<T>(db: Kysely<T>): Promise<void> {
  await sql`
    DO $$
    DECLARE
      r record;
    BEGIN
      FOR r IN
        SELECT c.relkind, format('%I.%I', n.nspname, c.relname) AS name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema()
          AND c.relkind IN ('v', 'm', 'r', 'p', 'f', 'S')
          AND NOT EXISTS (
            SELECT FROM pg_depend d
            WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
          )
        ORDER BY array_position(ARRAY['v', 'm', 'f', 'p', 'r', 'S']::"char"[], c.relkind)
      LOOP
        EXECUTE format(
          CASE r.relkind
            WHEN 'v' THEN 'DROP VIEW IF EXISTS %s CASCADE'
            WHEN 'm' THEN 'DROP MATERIALIZED VIEW IF EXISTS %s CASCADE'
            WHEN 'f' THEN 'DROP FOREIGN TABLE IF EXISTS %s CASCADE'
            WHEN 'S' THEN 'DROP SEQUENCE IF EXISTS %s CASCADE'
            ELSE 'DROP TABLE IF EXISTS %s CASCADE'
          END,
          r.name
        );
      END LOOP;

      FOR r IN
        SELECT p.oid::regprocedure::text AS name,
               CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END AS kind
        FROM pg_proc p
        WHERE p.pronamespace = current_schema()::regnamespace
          AND NOT EXISTS (
            SELECT FROM pg_depend d
            WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
          )
      LOOP
        EXECUTE format('DROP %s IF EXISTS %s CASCADE', r.kind, r.name);
      END LOOP;

      FOR r IN
        SELECT format('%I.%I', n.nspname, t.typname) AS name
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = current_schema()
          AND t.typtype IN ('e', 'd', 'r', 'm', 'c')
          AND (t.typtype <> 'c' OR (SELECT c.relkind FROM pg_class c WHERE c.oid = t.typrelid) = 'c')
          AND NOT EXISTS (
            SELECT FROM pg_depend d
            WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e'
          )
      LOOP
        EXECUTE format('DROP TYPE IF EXISTS %s CASCADE', r.name);
      END LOOP;
    END
    $$
  `.execute(db);
}
