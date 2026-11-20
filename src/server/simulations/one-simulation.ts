// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// One simulation at a time per student (S10, D10, owner 2026-11-20 on #379): a student is in at
// most one lab whose simulation is not finished. Every path that puts a student in a lab asks
// this check inside its own transaction, after it has locked the simulation row; the trigger of
// migration 0026 holds the same rule. Relative imports and no server-only marker: linking.ts
// loads it in plain Node.
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";

/**
 * Returns whether `userId` is in a lab of a prepared or running simulation other than
 * `simulationId`. Locks the student's user row first (`FOR NO KEY UPDATE`), the lock the trigger
 * of migration 0026 takes, so two places for one student into two simulations are decided one
 * after the other: the second reads the first's committed place in its next statement. Call it
 * after the simulation row is locked (simulations before users).
 */
export async function inOtherActiveSimulation(
  trx: Kysely<DB>,
  userId: string,
  simulationId: string,
): Promise<boolean> {
  await trx
    .selectFrom("user")
    .select("id")
    .where("id", "=", userId)
    .forNoKeyUpdate()
    .executeTakeFirst();
  const row = await trx
    .selectFrom("lab_members")
    .innerJoin("simulations", "simulations.id", "lab_members.simulation_id")
    .select("lab_members.simulation_id")
    .where("lab_members.user_id", "=", userId)
    .where("lab_members.simulation_id", "<>", simulationId)
    .where("simulations.state", "<>", "finished")
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
