// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The link of a waiting address (S10: "A student who signs in with an email address a teacher
// added to a lab lands in that lab without doing anything"). It runs at sign-in and when the
// student opens the Student portal overview, for a verified address only, one waiting row per
// transaction, so one bad row never undoes another. Relative imports and no server-only marker:
// auth.ts loads this in plain Node for `pnpm db:seed`.
import { type Kysely, sql } from "kysely";
import { validateRoleValue } from "../../lib/roles.ts";
import { isAsciiEmail, normalizeEmail } from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { inOtherActiveSimulation } from "./one-simulation.ts";
import { removedAt } from "./removals.ts";

/** What one link run did. */
export interface LinkOutcome {
  /** Waiting addresses that became a place in their lab. */
  linked: number;
  /**
   * Waiting addresses refused: dropped because the student is in another lab of that simulation,
   * or kept because a teacher removed the student from it (#330) or the student is in another
   * simulation that is not finished (#379).
   */
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
  if (!isAsciiEmail(email)) return false;
  const row = await db
    .selectFrom("lab_member_emails")
    .select("simulation_id")
    .where("email", "=", normalizeEmail(email))
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

type RowOutcome = "linked" | "refused" | "gone";

/** Why a link keeps its address waiting; each is logged once per address or removal. */
type LinkRefusal = "removed" | "in_other_simulation" | "simulation_finished";

/**
 * Returns whether a link refusal with `reason` was logged for `userId` in the simulation at or
 * after `since`: the time of their removal record, or the time the address was added.
 */
async function refusedSince(
  trx: Kysely<DB>,
  simulationId: string,
  userId: string,
  reason: LinkRefusal,
  since: Date,
): Promise<boolean> {
  const row = await trx
    .selectFrom("audit_event")
    .select("id")
    .where("action", "=", "lab_member_joined")
    .where("outcome", "=", "refused")
    .where("reason_code", "=", reason)
    .where("actor_type", "=", "user")
    .where("actor_id", "=", userId)
    .where(sql<string>`metadata ->> 'simulation_id'`, "=", simulationId)
    .where("occurred_at", ">=", since)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

async function linkRow(
  db: Kysely<DB>,
  userId: string,
  email: string,
  simulationId: string,
  now: Date,
): Promise<RowOutcome> {
  return db.transaction().execute(async (trx) => {
    // NOTE: #280; the simulation row first, as every teacher write locks it, then the address.
    const simulation = await trx
      .selectFrom("simulations")
      .select("state")
      .where("id", "=", simulationId)
      .forUpdate()
      .executeTakeFirst();
    const waiting = await trx
      .selectFrom("lab_member_emails")
      .select(["lab_id", "added_at"])
      .where("simulation_id", "=", simulationId)
      .where("email", "=", email)
      .forUpdate()
      .executeTakeFirst();
    if (!waiting) return "gone";
    const event = {
      action: "lab_member_joined",
      actor: { type: "user", id: userId },
      target: { type: "lab", id: waiting.lab_id },
    } as const;
    const metadata = { simulation_id: simulationId, user_id: userId, join_via: "email" } as const;
    /** Logs a refusal that keeps the address waiting, once from `since` on. */
    const refuseOnce = async (reason: LinkRefusal, since: Date) => {
      if (!(await refusedSince(trx, simulationId, userId, reason, since))) {
        // A `now` taken before this transaction waited on the lock can predate `since`; the row
        // then carries that time, so the check above finds it next time.
        const occurredAt = now.getTime() < since.getTime() ? since : now;
        await recordAudit(trx, { ...event, outcome: "refused", reason, metadata, occurredAt });
      }
      return "refused" as const;
    };
    // NOTE: maintainer on the review of #392 (N2); a finished simulation is history and links no one.
    if (simulation?.state === "finished") {
      return refuseOnce("simulation_finished", waiting.added_at);
    }
    const removal = await removedAt(trx, simulationId, userId);
    if (removal !== null) {
      // NOTE: #330 (maintainer, 2026-11-20); a teacher's removal wins over a waiting address, which
      // stays (it may be a classmate's), and the refusal is logged once per removal.
      return refuseOnce("removed", removal);
    }
    const place = await trx
      .selectFrom("lab_members")
      .select("lab_id")
      .where("simulation_id", "=", simulationId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    const remove = () =>
      trx
        .deleteFrom("lab_member_emails")
        .where("simulation_id", "=", simulationId)
        .where("email", "=", email)
        .execute();
    if (place && place.lab_id !== waiting.lab_id) {
      // NOTE: S10 (maintainer, 2026-11-19, #287); the address goes with its one refusal row, so a
      // later sign-in or overview read writes nothing more.
      await remove();
      await recordAudit(trx, { ...event, outcome: "refused", reason: "in_other_lab", metadata });
      return "refused";
    }
    if (!place) {
      if (await inOtherActiveSimulation(trx, userId, simulationId)) {
        // NOTE: #379 (owner, 2026-11-20); the address keeps waiting and links once the student's
        // other simulation is finished; the refusal is logged once per address.
        return refuseOnce("in_other_simulation", waiting.added_at);
      }
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
    await remove();
    return "linked";
  });
}

/**
 * Links every address that waits for the verified email of `userId` to its lab, one row per
 * transaction. An unverified address, an address that is not plain ASCII, and an account that is
 * not only a student link nothing. A student already in another lab of that simulation stays
 * there: the waiting address is deleted and the refusal is logged once. A student a teacher
 * removed from the simulation is refused, logged once per removal, and the address keeps waiting
 * (#330). A student in a lab of another prepared or running simulation is refused with
 * `in_other_simulation`, logged once per address, and the address keeps waiting (#379); the
 * simulations are tried in the order of their ids, so the first that links wins. An address of a
 * finished simulation never links (review of #392, N2).
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
  if (!isAsciiEmail(user.email)) return NONE;
  const email = normalizeEmail(user.email);
  const rows = await db
    .selectFrom("lab_member_emails")
    .innerJoin("simulations", "simulations.id", "lab_member_emails.simulation_id")
    .select(["lab_member_emails.simulation_id", "lab_member_emails.added_at"])
    .where("lab_member_emails.email", "=", email)
    .where("simulations.state", "<>", "finished")
    .orderBy("lab_member_emails.simulation_id")
    .execute();
  const outcome = { ...NONE };
  for (const row of rows) {
    // NOTE: security review of #392 (S2); a refusal already logged is decided without a lock, so
    // a student in another simulation does not take this simulation's row on every overview read.
    if (
      (await inOtherActiveSimulation(db, userId, row.simulation_id, { lock: false })) &&
      (await refusedSince(db, row.simulation_id, userId, "in_other_simulation", row.added_at))
    ) {
      outcome.refused += 1;
      continue;
    }
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
