// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// A database per test run: `pnpm test` and `pnpm test:e2e` each create `<base>_<run id>` next
// to the database their URL names, on the same server with the same user, and drop it when the
// run ends, so parallel runs (worktrees on one machine) never share a schema or a lock.
// Relative imports and no Vite-only syntax: the Playwright config and plain Node load this file.
import { randomBytes } from "node:crypto";
import pg from "pg";

/** A run database older than this is left over from a crashed run and dropped at the next start. */
export const STALE_RUN_DATABASE_MS = 6 * 60 * 60 * 1000;

// The run id: the creation second in base 36, then 6 random hex digits.
const RUN_ID = /^([0-9a-z]{1,10})_([0-9a-f]{6})$/;

/** Returns a new run id; its first part is `now` in seconds, so a later run can tell its age. */
export function newRunId(now: Date = new Date()): string {
  const seconds = Math.floor(now.getTime() / 1000).toString(36);
  return `${seconds}_${randomBytes(3).toString("hex")}`;
}

/** Returns the name of the run database of `base` for `runId`. */
export function runDatabaseName(base: string, runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error(`"${runId}" is not a test run id.`);
  return `${base}_${runId}`;
}

/** Returns when the run database `name` of `base` was created, or `undefined` for any other name. */
export function runDatabaseCreatedAt(base: string, name: string): Date | undefined {
  if (!name.startsWith(`${base}_`)) return undefined;
  const match = RUN_ID.exec(name.slice(base.length + 1));
  const seconds = match?.[1];
  return seconds === undefined ? undefined : new Date(Number.parseInt(seconds, 36) * 1000);
}

/** Returns the run databases of `base` among `names` created more than `maxAgeMs` before `now`. */
export function staleRunDatabases(
  base: string,
  names: readonly string[],
  now: Date,
  maxAgeMs: number = STALE_RUN_DATABASE_MS,
): string[] {
  return names.filter((name) => {
    const createdAt = runDatabaseCreatedAt(base, name);
    return createdAt !== undefined && now.getTime() - createdAt.getTime() > maxAgeMs;
  });
}

/** Returns the database name `url` points at. */
export function databaseOf(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (name === "") throw new Error("The database URL names no database.");
  return name;
}

/** Returns `url` with its database replaced by `database`; server, user and password stay. */
export function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${encodeURIComponent(database)}`;
  return next.toString();
}

/** Runs `work` on one connection to the database `baseUrl` names, then closes it. */
async function onBase<T>(baseUrl: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: baseUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/**
 * Drops the database `name` this user owns, after closing it to new sessions and ending the
 * sessions this user holds on it (a crashed run, a still-running app server).
 *
 * NOTE: no `WITH (FORCE)`. FORCE refuses with "permission denied to terminate process" when an
 * autovacuum worker is on the database: the worker has no role, so a role without
 * `pg_signal_backend` may not end it (shown on PostgreSQL 18.6, #199). The plain statement
 * signals autovacuum workers itself and waits up to 5 seconds for them to leave. No other role
 * can hold a session here: `createRunDatabase` revokes CONNECT from PUBLIC.
 */
async function dropDatabase(client: pg.Client, name: string): Promise<void> {
  const { rows } = await client.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE datname = $1",
    [name],
  );
  if (rows.length === 0) return;
  const database = pg.escapeIdentifier(name);
  await client.query(`ALTER DATABASE ${database} WITH ALLOW_CONNECTIONS false`);
  await client.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity " +
      "WHERE datname = $1 AND usename = current_user AND pid <> pg_backend_pid()",
    [name],
  );
  await client.query(`DROP DATABASE IF EXISTS ${database}`);
}

/**
 * Creates the run database of `runId` next to the database `baseUrl` names, after dropping the
 * stale run databases of the same base this user owns, and returns its URL. The new database is
 * empty: the caller migrates it.
 *
 * @throws Error naming the missing privilege when the user may not create databases.
 */
export async function createRunDatabase(baseUrl: string, runId: string): Promise<string> {
  const base = databaseOf(baseUrl);
  const name = runDatabaseName(base, runId);
  await onBase(baseUrl, async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE pg_get_userbyid(datdba) = current_user ORDER BY datname",
    );
    for (const stale of staleRunDatabases(
      base,
      rows.map((row) => row.datname),
      new Date(),
    )) {
      await dropDatabase(client, stale);
    }
    try {
      await client.query(
        `CREATE DATABASE ${pg.escapeIdentifier(name)} ENCODING 'UTF8' TEMPLATE template0`,
      );
    } catch (error) {
      if (error instanceof Error && Reflect.get(error, "code") === "42501") {
        throw new Error(
          `The database user may not create the test run database ${name}. Grant it once on ` +
            "the dev stack: podman compose -f compose.dev.yaml exec -T postgres psql -U postgres " +
            '-c "ALTER ROLE edulims CREATEDB" (or docker compose).',
          { cause: error },
        );
      }
      throw error;
    }
    await client.query(`REVOKE ALL ON DATABASE ${pg.escapeIdentifier(name)} FROM PUBLIC`);
  });
  return withDatabase(baseUrl, name);
}

/** Drops the run database `runUrl` names, through a connection to the database `baseUrl` names. */
export async function dropRunDatabase(baseUrl: string, runUrl: string): Promise<void> {
  const base = databaseOf(baseUrl);
  const name = databaseOf(runUrl);
  if (runDatabaseCreatedAt(base, name) === undefined) {
    throw new Error(`Refusing to drop ${name}: it is not a run database of ${base}.`);
  }
  await onBase(baseUrl, (client) => dropDatabase(client, name));
}
