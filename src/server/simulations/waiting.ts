// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The waiting addresses of one student in one simulation (S10, R-01, #323, #330): a place in a lab
// and a waiting address of the same student should not stand side by side. An address waits in at
// most one lab per simulation (`lab_member_emails_pk`), so a drop deletes 0 or 1 rows. The link
// refuses a removed student on its own (`linkWaitingAddresses`). Relative imports and no
// server-only marker, as removals.ts.
import type { Kysely } from "kysely";
import { isAsciiEmail, normalizeEmail } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";

/**
 * Why a student's waiting addresses go, which decides which of them go.
 *
 * - `join`: a code join drops every address in the simulation, for a verified email only.
 * - `removal`: drops every address in the simulation for a verified email, and only the ones
 *   waiting in `leftLabId` for an unverified email (#330).
 * - `move`: as `removal`, but a verified email keeps the address waiting in `targetLabId`.
 */
export type DropWaiting =
  | { kind: "join" }
  | { kind: "removal"; leftLabId: string }
  | { kind: "move"; leftLabId: string; targetLabId: string };

/**
 * Deletes the addresses that wait for `userId`'s email in the simulation, inside the caller's
 * transaction (after the simulation row is locked), and returns how many went. An address that is
 * not plain ASCII never links (`linkWaitingAddresses`), so it is left alone. An unverified email
 * may be another person's address, so it never reaches beyond the lab the student leaves.
 */
export async function dropWaitingAddressesOf(
  trx: Kysely<DB>,
  simulationId: string,
  userId: string,
  drop: DropWaiting,
): Promise<number> {
  const user = await trx
    .selectFrom("user")
    .select(["email", "emailVerified"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user || !isAsciiEmail(user.email)) return 0;
  let query = trx
    .deleteFrom("lab_member_emails")
    .where("simulation_id", "=", simulationId)
    .where("email", "=", normalizeEmail(user.email));
  switch (drop.kind) {
    case "join":
      if (!user.emailVerified) return 0;
      break;
    case "removal":
      if (!user.emailVerified) query = query.where("lab_id", "=", drop.leftLabId);
      break;
    case "move":
      query = user.emailVerified
        ? query.where("lab_id", "<>", drop.targetLabId)
        : query.where("lab_id", "=", drop.leftLabId);
      break;
    default: {
      const unknown: never = drop;
      throw new Error(`unknown drop ${JSON.stringify(unknown)}`);
    }
  }
  const deleted = await query.executeTakeFirst();
  return Number(deleted.numDeletedRows);
}
