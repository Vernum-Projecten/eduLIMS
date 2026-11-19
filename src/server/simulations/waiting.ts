// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The waiting addresses of one student in one simulation (S10, R-01, #323): a place in a lab and a
// waiting address of the same student must never stand side by side, or the next link would put
// a removed student back and clear their removal record. Relative imports and no server-only
// marker, as removals.ts.
import type { Kysely } from "kysely";
import { isAsciiEmail, normalizeEmail } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";

/** Which of a student's waiting addresses go. */
export interface DropWaiting {
  /** Keeps an address that waits in this lab (a move keeps the one in its target). */
  exceptLabId?: string;
  /** Drops nothing for an unverified address: it may not be the student's own (a code join). */
  verifiedOnly: boolean;
}

/**
 * Deletes the addresses that wait for `userId`'s email in the simulation, inside the caller's
 * transaction (after the simulation row is locked), and returns how many went. An address that is
 * not plain ASCII never links (`linkWaitingAddresses`), so it is left alone.
 */
export async function dropWaitingAddressesOf(
  trx: Kysely<DB>,
  simulationId: string,
  userId: string,
  options: DropWaiting,
): Promise<number> {
  const user = await trx
    .selectFrom("user")
    .select(["email", "emailVerified"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user || !isAsciiEmail(user.email)) return 0;
  if (options.verifiedOnly && !user.emailVerified) return 0;
  let query = trx
    .deleteFrom("lab_member_emails")
    .where("simulation_id", "=", simulationId)
    .where("email", "=", normalizeEmail(user.email));
  if (options.exceptLabId !== undefined) query = query.where("lab_id", "<>", options.exceptLabId);
  const deleted = await query.executeTakeFirst();
  return Number(deleted.numDeletedRows);
}
