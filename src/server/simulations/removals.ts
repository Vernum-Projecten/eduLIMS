// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The students a teacher removed from a simulation (#280): a removed student cannot rejoin with a
// lab's code (#288) or through a waiting address (#330) until a teacher adds their address to a
// lab again, which clears the record.
// Relative imports and no server-only marker: the sign-in link loads this in plain Node.
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { storedEmailIsAscii } from "./ascii-email.ts";

/** Records that `userId` was removed from the simulation by `actorId`. */
export async function recordRemoval(
  trx: Kysely<DB>,
  simulationId: string,
  userId: string,
  actorId: string,
  now: Date,
): Promise<void> {
  await trx
    .insertInto("simulation_removals")
    .values({ simulation_id: simulationId, user_id: userId, removed_by: actorId, removed_at: now })
    .onConflict((conflict) =>
      conflict
        .columns(["simulation_id", "user_id"])
        .doUpdateSet({ removed_by: actorId, removed_at: now }),
    )
    .execute();
}

/** Returns whether a teacher removed `userId` from the simulation and nobody added them since. */
export async function wasRemoved(
  trx: Kysely<DB>,
  simulationId: string,
  userId: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom("simulation_removals")
    .select("user_id")
    .where("simulation_id", "=", simulationId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Clears the removals of the accounts with these (normalised) addresses: a teacher added them
 * again. An account whose stored address is not plain ASCII never matches.
 */
export async function clearRemovalsOfAddresses(
  trx: Kysely<DB>,
  simulationId: string,
  emails: readonly string[],
): Promise<void> {
  if (emails.length === 0) return;
  await trx
    .deleteFrom("simulation_removals")
    .where("simulation_id", "=", simulationId)
    .where("user_id", "in", (q) =>
      q
        .selectFrom("user")
        .select("id")
        .where((eb) => eb(eb.fn("lower", ["email"]), "in", [...emails]))
        .where(storedEmailIsAscii()),
    )
    .execute();
}
