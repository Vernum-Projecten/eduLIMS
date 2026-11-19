// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The link of a waiting address (S10: "A student who signs in with an email address a teacher
// added to a lab lands in that lab without doing anything"). It runs at sign-in and when the
// student opens the Student portal overview, for a verified address only, one waiting row per
// transaction, so one bad row never undoes another. Relative imports and no server-only marker:
// auth.ts loads this in plain Node for `pnpm db:seed`.
import type { Kysely } from "kysely";
import { validateRoleValue } from "../../lib/roles.ts";
import { normalizeEmail } from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { clearRemoval } from "./removals.ts";

/** What one link run did. */
export interface LinkOutcome {
  /** Waiting addresses that became a place in their lab. */
  linked: number;
  /** Waiting addresses left waiting because the student is in another lab of that simulation. */
  refused: number;
  /** Waiting addresses whose transaction failed; they stay waiting for the next run. */
  failed: number;
}

const NONE: LinkOutcome = { linked: 0, refused: 0, failed: 0 };

/**
 * Returns whether `email` waits in a lab of any simulation: the one case in which an identity
 * provider sign-in grants the app role student at a first sign-in (S10, `createIdpRoleSync`).
 */
export async function hasWaitingLabAddress(db: Kysely<DB>, email: string): Promise<boolean> {
  const row = await db
    .selectFrom("lab_member_emails")
    .select("simulation_id")
    .where("email", "=", normalizeEmail(email))
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

type RowOutcome = "linked" | "refused" | "gone";

async function linkRow(
  db: Kysely<DB>,
  userId: string,
  email: string,
  simulationId: string,
  now: Date,
): Promise<RowOutcome> {
  return db.transaction().execute(async (trx) => {
    // NOTE: #280; the simulation row first, as every teacher write locks it, then the address.
    await trx
      .selectFrom("simulations")
      .select("id")
      .where("id", "=", simulationId)
      .forUpdate()
      .executeTakeFirst();
    const waiting = await trx
      .selectFrom("lab_member_emails")
      .select("lab_id")
      .where("simulation_id", "=", simulationId)
      .where("email", "=", email)
      .forUpdate()
      .executeTakeFirst();
    if (!waiting) return "gone";
    const place = await trx
      .selectFrom("lab_members")
      .select("lab_id")
      .where("simulation_id", "=", simulationId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    const event = {
      action: "lab_member_joined",
      actor: { type: "user", id: userId },
      target: { type: "lab", id: waiting.lab_id },
    } as const;
    const metadata = { simulation_id: simulationId, user_id: userId, join_via: "email" } as const;
    if (place && place.lab_id !== waiting.lab_id) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "in_other_lab", metadata });
      return "refused";
    }
    if (!place) {
      await trx
        .insertInto("lab_members")
        .values({
          simulation_id: simulationId,
          lab_id: waiting.lab_id,
          user_id: userId,
          joined_at: now,
          joined_via: "email",
        })
        .execute();
      await recordAudit(trx, { ...event, outcome: "success", metadata });
    }
    await trx
      .deleteFrom("lab_member_emails")
      .where("simulation_id", "=", simulationId)
      .where("email", "=", email)
      .execute();
    await clearRemoval(trx, simulationId, userId);
    return "linked";
  });
}

/**
 * Links every address that waits for the verified email of `userId` to its lab, one row per
 * transaction. An unverified address, and an account that is not only a student, links nothing.
 * A student already in another lab of that simulation stays there: the row is logged as a
 * refusal and keeps waiting for the teacher to remove it.
 */
export async function linkWaitingAddresses(
  db: Kysely<DB>,
  userId: string,
  now: Date,
): Promise<LinkOutcome> {
  const user = await db
    .selectFrom("user")
    .select(["email", "emailVerified", "role"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user?.emailVerified) return NONE;
  const parsed = validateRoleValue(user.role);
  if (!parsed.ok || parsed.roles.length !== 1 || parsed.roles[0] !== "student") return NONE;
  const email = normalizeEmail(user.email);
  const rows = await db
    .selectFrom("lab_member_emails")
    .select("simulation_id")
    .where("email", "=", email)
    .orderBy("simulation_id")
    .execute();
  const outcome = { ...NONE };
  for (const row of rows) {
    try {
      const result = await linkRow(db, userId, email, row.simulation_id, now);
      if (result === "linked") outcome.linked += 1;
      if (result === "refused") outcome.refused += 1;
    } catch (error) {
      // NOTE: S10 (#280); one failed row rolls back alone and waits for the next run, so the
      // student's other labs still link. The log line carries ids and the error class only.
      const kind = error instanceof Error ? error.name : "unknown";
      console.error(`lab_link_failed user=${userId} simulation=${row.simulation_id} ${kind}`);
      outcome.failed += 1;
    }
  }
  return outcome;
}
