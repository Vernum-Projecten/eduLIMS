// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The students a teacher removed from a class (#49, owner decision on the security review of
// #119): a removed student cannot rejoin with the class's live join code. A new invitation for
// their address, or any way back into the class, clears the record. Relative imports and no
// server-only marker: `pnpm db:seed` loads the invitation acceptance in plain Node.
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";

/** Records that `userId` was removed from the class by `actorId`. */
export async function recordRemoval(
  trx: Kysely<DB>,
  classId: string,
  userId: string,
  actorId: string,
  now: Date,
): Promise<void> {
  await trx
    .insertInto("class_removals")
    .values({ organization_id: classId, user_id: userId, removed_by: actorId, removed_at: now })
    .onConflict((conflict) =>
      conflict
        .columns(["organization_id", "user_id"])
        .doUpdateSet({ removed_by: actorId, removed_at: now }),
    )
    .execute();
}

/** Returns whether a teacher removed `userId` from the class, read in the caller's transaction. */
export async function wasRemoved(
  trx: Kysely<DB>,
  classId: string,
  userId: string,
): Promise<boolean> {
  const row = await trx
    .selectFrom("class_removals")
    .select("user_id")
    .where("organization_id", "=", classId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row !== undefined;
}

/** Clears the removal of `userId` from the class: they are back in it. */
export async function clearRemoval(
  trx: Kysely<DB>,
  classId: string,
  userId: string,
): Promise<void> {
  await trx
    .deleteFrom("class_removals")
    .where("organization_id", "=", classId)
    .where("user_id", "=", userId)
    .execute();
}

/** Clears the removals of the accounts with these (normalised) addresses: they are invited again. */
export async function clearRemovalsOfAddresses(
  trx: Kysely<DB>,
  classId: string,
  emails: readonly string[],
): Promise<void> {
  if (emails.length === 0) return;
  await trx
    .deleteFrom("class_removals")
    .where("organization_id", "=", classId)
    .where("user_id", "in", (q) =>
      q
        .selectFrom("user")
        .select("id")
        .where((eb) => eb(eb.fn("lower", ["email"]), "in", [...emails])),
    )
    .execute();
}
