// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Database tests on a real PostgreSQL 18: a database of this run, created next to
// `edulims_test` and migrated once by test-global-setup.ts, with every test in a transaction
// that is rolled back when the test destroys its Kysely instance.
import {
  CompiledQuery,
  type DatabaseConnection,
  type Driver,
  Kysely,
  type PostgresCursor,
  PostgresDialect,
  PostgresDriver,
  type PostgresPool,
  type PostgresPoolClient,
  type PostgresQueryResult,
  type TransactionSettings,
} from "kysely";
import { Client } from "pg";
import { inject } from "vitest";
import { TEST_DATABASE_LOCK_KEY } from "./advisory-locks.ts";
import type { DB } from "./schema.gen.ts";

declare module "vitest" {
  export interface ProvidedContext {
    /** The URL of this run's database, provided by test-global-setup.ts. */
    testDatabaseUrl: string;
  }
}

/** The database the run databases sit next to: the dev stack of compose.dev.yaml. */
export const DEFAULT_TEST_DATABASE_URL = "postgres://edulims:edulims@127.0.0.1:5432/edulims_test";

/**
 * The URL whose server, user and password every run uses, and next to whose database it creates
 * its own: `TEST_DATABASE_URL`, else {@link DEFAULT_TEST_DATABASE_URL}.
 */
export function baseTestDatabaseUrl(): string {
  const url = process.env["TEST_DATABASE_URL"]?.trim();
  return url ? url : DEFAULT_TEST_DATABASE_URL;
}

/** The URL of this run's database; available in a test, not in the global setup. */
export function testDatabaseUrl(): string {
  return inject("testDatabaseUrl");
}

/**
 * A driver on one pinned connection inside an open transaction: Kysely's own
 * transactions become savepoints, so code under test (better-auth, the migrator) can
 * commit and roll back as usual, and nothing outlives the outer rollback.
 */
class RollbackDriver extends PostgresDriver {
  #depth = 0;

  override async beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    if (settings.isolationLevel !== undefined || settings.accessMode !== undefined) {
      throw new Error("A test transaction cannot change the isolation level or access mode.");
    }
    this.#depth += 1;
    await connection.executeQuery(CompiledQuery.raw(`savepoint test_tx_${this.#depth}`));
  }

  override async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw(`release savepoint test_tx_${this.#depth}`));
    this.#depth -= 1;
  }

  override async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(
      CompiledQuery.raw(`rollback to savepoint test_tx_${this.#depth}`),
    );
    await connection.executeQuery(CompiledQuery.raw(`release savepoint test_tx_${this.#depth}`));
    this.#depth -= 1;
  }
}

class RollbackDialect extends PostgresDialect {
  readonly #pool: PostgresPool;

  constructor(pool: PostgresPool) {
    super({ pool });
    this.#pool = pool;
  }

  override createDriver(): Driver {
    return new RollbackDriver({ pool: this.#pool });
  }
}

/** The one pooled client of a test, plus a wait for the queries it still runs. */
export interface PinnedClient extends PostgresPoolClient {
  /** Resolves once no query is queued or running. */
  idle(): Promise<void>;
}

/**
 * Returns `client` as the one pooled client of a test, running its queries one after the other.
 *
 * Code under test may start a query before the previous one ends (`Promise.all` on one Kysely
 * instance, or a write the test does not await); a real pool runs those on separate
 * connections. Here they share one, and pg deprecates calling `query()` on a busy client, so
 * each query waits for the one before it.
 */
export function pinnedClient(client: Client): PinnedClient {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  function run<R>(sql: string, parameters: ReadonlyArray<unknown>): Promise<PostgresQueryResult<R>>;
  function run<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  function run<R>(
    sql: string | PostgresCursor<R>,
    parameters: ReadonlyArray<unknown> = [],
  ): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    // Kysely passes a cursor only for `.stream()`, which no test uses.
    if (typeof sql !== "string") throw new Error("A test database does not stream.");
    pending += 1;
    const result = tail.then(async () => {
      const { command, rowCount, rows } = await client.query(sql, [...parameters]);
      // pg types `command` as any string and `rowCount` as nullable; Kysely reads both only to
      // count the rows an INSERT, UPDATE, DELETE or MERGE affected, which always have a count.
      return {
        command: command as PostgresQueryResult<R>["command"],
        rowCount: rowCount ?? 0,
        rows,
      };
    });
    // NOTE: no requirement governs this: our own design. The chain only orders the queries;
    // every caller still gets its own result or error from `result`.
    const settle = () => {
      pending -= 1;
    };
    tail = result.then(settle, settle);
    return result;
  }
  return {
    query: run,
    release: () => undefined,
    idle: async () => {
      while (pending > 0) await tail;
    },
  };
}

/**
 * Returns a Kysely instance on the migrated test database, inside a transaction that
 * `destroy()` rolls back. Call `destroy()` after every test (`afterEach`).
 */
export async function createTestDb(): Promise<Kysely<DB>> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [TEST_DATABASE_LOCK_KEY]);
  } catch (error) {
    await client.end();
    throw error;
  }
  const pinned = pinnedClient(client);
  let ended: Promise<void> | undefined;
  const end = () => {
    ended ??= (async () => {
      try {
        // A query the test did not await finishes first, so the rollback never queues behind it.
        await pinned.idle();
        await client.query("rollback");
      } finally {
        await client.end();
      }
    })();
    return ended;
  };
  const pool: PostgresPool = { options: {}, connect: async () => pinned, end };
  return new TestKysely(pool, end);
}

/** A Kysely instance whose `destroy()` always ends the test connection. */
class TestKysely extends Kysely<DB> {
  readonly #end: () => Promise<void>;

  constructor(pool: PostgresPool, end: () => Promise<void>) {
    super({ dialect: new RollbackDialect(pool) });
    this.#end = end;
  }

  // NOTE: no requirement governs this: our own design. Kysely ends the pool only once it has
  // acquired a connection, so a test without a query kept the connection and the test lock.
  override async destroy(): Promise<void> {
    await super.destroy();
    await this.#end();
  }
}
