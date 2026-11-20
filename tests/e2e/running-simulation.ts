// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One simulation runs at a time (D11, #386), across the whole run's database. The journeys that
// need a running simulation run one after the other in the `chromium-running` project
// (playwright.config.ts), and each finishes whatever an earlier journey left running before it
// writes or starts its own.
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { DB } from "../../src/server/db/schema.gen.ts";

/** Finishes every running simulation in `db`, at the database's clock (test set-up only). */
export async function finishRunning(db: Kysely<DB>): Promise<void> {
  await db
    .updateTable("simulations")
    .set({ state: "finished", finished_at: sql<Date>`greatest(now(), started_at)` })
    .where("state", "=", "running")
    .execute();
}

/** Runs `write` against this run's database on a connection of its own, and closes it. */
async function withDatabase<T>(write: (db: Kysely<DB>) => Promise<T>): Promise<T> {
  const url = process.env["EDULIMS_E2E_DATABASE_URL"];
  if (!url) throw new Error("EDULIMS_E2E_DATABASE_URL is not set; playwright.config.ts sets it.");
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });
  try {
    return await write(db);
  } finally {
    await db.destroy();
  }
}

/** Finishes every running simulation of this run's database. */
export function finishRunningSimulations(): Promise<void> {
  return withDatabase(finishRunning);
}

/** What {@link seedAnotherRunning} stored: two invented simulations, by name. */
export interface AnotherRunningWorld {
  /** Prepared, taught by the seeded teacher. */
  preparedId: string;
  prepared: string;
  /** Running, taught by nobody the journey signs in as. */
  running: string;
}

/**
 * Stores a running simulation that no seeded account teaches and a prepared one of the seeded
 * teacher, under the run-unique `suffix`; an earlier journey's running one is finished first.
 */
export function seedAnotherRunning(suffix: string): Promise<AnotherRunningWorld> {
  const prepared = `Next run ${suffix}`;
  const running = `Elsewhere run ${suffix}`;
  return withDatabase((db) =>
    db.transaction().execute(async (trx) => {
      await finishRunning(trx);
      const teacher = await trx
        .selectFrom("user")
        .select("id")
        .where("email", "=", "teacher@example.test")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("simulations")
        .values({ name: running, state: "running", started_at: sql<Date>`now()` })
        .execute();
      const { id: preparedId } = await trx
        .insertInto("simulations")
        .values({ name: prepared, created_by: teacher.id })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("simulation_teachers")
        .values({ simulation_id: preparedId, user_id: teacher.id })
        .execute();
      return { preparedId, prepared, running };
    }),
  );
}
