// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Database tests on a real PostgreSQL 18: the `edulims_test` database, cleared and
// migrated once per run by test-global-setup.ts, with every test in a transaction that
// is rolled back when the test destroys its Kysely instance.
import {
  CompiledQuery,
  type DatabaseConnection,
  type Driver,
  Kysely,
  PostgresDialect,
  PostgresDriver,
  type PostgresPool,
  type TransactionSettings,
} from "kysely";
import { Client } from "pg";
import type { DB } from "./schema.gen.ts";

/** The Vitest database on the dev stack of compose.dev.yaml; CI sets its service container. */
export const DEFAULT_TEST_DATABASE_URL = "postgres://edulims:edulims@127.0.0.1:5432/edulims_test";

/** The URL of the Vitest database: `TEST_DATABASE_URL`, else {@link DEFAULT_TEST_DATABASE_URL}. */
export function testDatabaseUrl(): string {
  const url = process.env["TEST_DATABASE_URL"]?.trim();
  return url ? url : DEFAULT_TEST_DATABASE_URL;
}

// NOTE: no requirement governs this: our own design. One key for every database test,
// held for the whole test transaction, so tests in parallel files run one at a time.
const TEST_LOCK_KEY = 7_212_026_018;

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

/**
 * Returns a Kysely instance on the migrated test database, inside a transaction that
 * `destroy()` rolls back. Call `destroy()` after every test (`afterEach`).
 */
export async function createTestDb(): Promise<Kysely<DB>> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [TEST_LOCK_KEY]);
  } catch (error) {
    await client.end();
    throw error;
  }
  const pinned = Object.assign(client, { release: () => undefined });
  const pool: PostgresPool = {
    options: {},
    connect: async () => pinned,
    end: async () => {
      try {
        await client.query("rollback");
      } finally {
        await client.end();
      }
    },
  };
  return new Kysely<DB>({ dialect: new RollbackDialect(pool) });
}
