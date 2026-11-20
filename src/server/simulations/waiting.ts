// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The waiting addresses of one student in one simulation (S10, R-01, #323, #330): a code join, a
// removal and a move drop the student's waiting address, for a verified email only. An address
// waits in at most one lab per simulation (`lab_member_emails_pk`), so a drop deletes 0 or 1 rows.
// The link refuses a removed student on its own (`linkWaitingAddresses`). Relative imports and no
// server-only marker, as removals.ts.
import type { Kysely } from "kysely";
import { isAsciiEmail, normalizeEmail } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";

/** Which of a student's waiting addresses stay. */
export interface DropWaiting {
  /** Keeps an address that waits in this lab (a move keeps the one in its target). */
  exceptLabId?: string;
}

/**
 * Deletes the address that waits for `userId`'s verified email in the simulation, inside the
 * caller's transaction (after the simulation row is locked), and returns how many rows went.
 *
 * An unverified email drops nothing: it may be a classmate's address, and that classmate's own
 * sign-in must still link through it (#330). An address that is not plain ASCII never links
 * (`linkWaitingAddresses`), so it is left alone.
 */
export async function dropWaitingAddressesOf(
  trx: Kysely<DB>,
  simulationId: string,
  userId: string,
  options: DropWaiting = {},
): Promise<number> {
  const user = await trx
    .selectFrom("user")
    .select(["email", "emailVerified"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user?.emailVerified || !isAsciiEmail(user.email)) return 0;
  let query = trx
    .deleteFrom("lab_member_emails")
    .where("simulation_id", "=", simulationId)
    .where("email", "=", normalizeEmail(user.email));
  if (options.exceptLabId !== undefined) query = query.where("lab_id", "<>", options.exceptLabId);
  const deleted = await query.executeTakeFirst();
  return Number(deleted.numDeletedRows);
}
