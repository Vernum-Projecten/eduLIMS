// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Deleting a user (B1, D10, #318), where the GDPR erasure path of #47 ends. eduLIMS deletes the
// user itself, in one transaction: the simulations the user teaches are locked first, in id order as every
// simulation write locks them, then the last-teacher rule is judged, then the sessions, the
// accounts and the user go with their activity-log rows. A refusal changes nothing.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import { storedRoleSetsWith } from "../../lib/roles.ts";
import { type AuditActor, toRequestId } from "../audit/events.ts";
import { recordAudit, recordCommittedAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import { isLastTeacherViolation } from "../simulations/teachers.ts";
import { type ActionContext, assertAdmin } from "./actions.ts";

/** The refusal code of deleting the only active teacher of a simulation (D10). */
export const ONLY_SIMULATION_TEACHER = "only_simulation_teacher" as const;

/** The refusal code of an administrator deleting their own account. */
export const CANNOT_DELETE_SELF = "cannot_delete_self" as const;

const TEACHER_ROLE_VALUES: readonly string[] = storedRoleSetsWith("teacher");

/** Why a deletion was refused; nothing changed. */
export type DeleteUserError =
  | "not_found"
  | typeof CANNOT_DELETE_SELF
  | typeof ONLY_SIMULATION_TEACHER;

/** The outcome of a deletion: done, or refused with a code. */
export type DeleteUserResult = { ok: true } | { ok: false; error: DeleteUserError };

type Deletion = DeleteUserResult;

/**
 * Locks every simulation `userId` teaches (`FOR UPDATE`), in id order: the order the
 * simulations service takes a simulation's lock in, before any user row, so a deletion and a
 * teacher change of one simulation queue on that row instead of deadlocking.
 */
async function lockTaughtSimulations(trx: Kysely<DB>, userId: string): Promise<void> {
  await trx
    .selectFrom("simulations")
    .innerJoin("simulation_teachers", "simulation_teachers.simulation_id", "simulations.id")
    .select("simulations.id")
    .where("simulation_teachers.user_id", "=", userId)
    .orderBy("simulations.id")
    .forUpdate("simulations")
    .execute();
}

/**
 * Returns whether `userId` holds the app role teacher and teaches a simulation in which no other
 * teacher row belongs to a user who holds that role (D10); a user without the role is never the
 * only teacher (maintainer, 2026-11-19, #311). Read under the simulation locks; the other
 * teachers' rows are locked `FOR SHARE`, as the `BEFORE DELETE` trigger of migration 0012 does.
 */
export async function isOnlyTeacherOfASimulation(
  trx: Kysely<DB>,
  userId: string,
): Promise<boolean> {
  const target = await trx
    .selectFrom("user")
    .select("id")
    .where("id", "=", userId)
    .where("role", "in", TEACHER_ROLE_VALUES)
    .executeTakeFirst();
  if (!target) return false;
  const mine = await trx
    .selectFrom("simulation_teachers")
    .select("simulation_id")
    .where("user_id", "=", userId)
    .orderBy("simulation_id")
    .execute();
  if (mine.length === 0) return false;
  const covered = await trx
    .selectFrom("simulation_teachers")
    .innerJoin("user", "user.id", "simulation_teachers.user_id")
    .select("simulation_teachers.simulation_id")
    .where(
      "simulation_teachers.simulation_id",
      "in",
      mine.map((row) => row.simulation_id),
    )
    .where("simulation_teachers.user_id", "<>", userId)
    .where("user.role", "in", TEACHER_ROLE_VALUES)
    .orderBy("simulation_teachers.simulation_id")
    .orderBy("simulation_teachers.user_id")
    .forShare(["simulation_teachers", "user"])
    .execute();
  const taught = new Set(covered.map((row) => row.simulation_id));
  return mine.some((row) => !taught.has(row.simulation_id));
}

async function deleteInTransaction(
  trx: Transaction<DB>,
  userId: string,
  actor: AuditActor,
  requestId: string | undefined,
): Promise<Deletion> {
  await lockTaughtSimulations(trx, userId);
  const user = await trx
    .selectFrom("user")
    .select("id")
    .where("id", "=", userId)
    .forUpdate()
    .executeTakeFirst();
  if (!user) return { ok: false, error: "not_found" };
  if (await isOnlyTeacherOfASimulation(trx, userId)) {
    return { ok: false, error: ONLY_SIMULATION_TEACHER };
  }
  const sessions = await trx
    .deleteFrom("session")
    .where("userId", "=", userId)
    .returning("id")
    .execute();
  await trx.deleteFrom("account").where("userId", "=", userId).execute();
  await trx.deleteFrom("user").where("id", "=", userId).execute();
  const common = requestId ? { requestId } : {};
  for (const session of sessions.toSorted((a, b) => a.id.localeCompare(b.id))) {
    await recordAudit(trx, {
      action: "session_revoked",
      actor,
      outcome: "success",
      target: { type: "session", id: session.id },
      reason: "user_deleted",
      ...common,
    });
  }
  await recordAudit(trx, {
    action: "user_deleted",
    actor,
    outcome: "success",
    target: { type: "user", id: userId },
    ...common,
  });
  return { ok: true };
}

/**
 * Deletes a user with their sessions and accounts in one transaction (B1, D10). An administrator
 * cannot delete themself (`cannot_delete_self`), and the only active teacher of a simulation is
 * refused (`only_simulation_teacher`); both refusals are logged and change nothing. Every
 * session gets a `session_revoked` row and the user a `user_deleted` row, ids only (B4).
 */
export async function deleteUser(
  ctx: ActionContext,
  input: { userId: string },
): Promise<DeleteUserResult> {
  // TODO(#47): the GDPR erasure path calls this after it anonymised the user's records.
  assertAdmin(ctx.actor);
  const actor = { type: "user", id: ctx.actor.id } as const;
  const requestId = toRequestId(ctx.headers.get("x-request-id"));
  const refusal = (reason: string) =>
    recordCommittedAudit(ctx.db, {
      action: "user_deleted",
      actor,
      outcome: "refused",
      target: { type: "user", id: input.userId },
      reason,
      ...(requestId ? { requestId } : {}),
    });
  if (input.userId === ctx.actor.id) {
    await refusal(CANNOT_DELETE_SELF);
    return { ok: false, error: CANNOT_DELETE_SELF };
  }
  let outcome: Deletion;
  try {
    outcome = await ctx.db
      .transaction()
      .execute((trx) => deleteInTransaction(trx, input.userId, actor, requestId));
  } catch (error) {
    // NOTE: D10 (#318); the trigger of migration 0012 is the last line, for a simulation the
    // user joined after the locks were taken. The transaction rolled back, so nothing changed.
    if (!isLastTeacherViolation(error)) throw error;
    outcome = { ok: false, error: ONLY_SIMULATION_TEACHER };
  }
  if (!outcome.ok && outcome.error === ONLY_SIMULATION_TEACHER) {
    await refusal(ONLY_SIMULATION_TEACHER);
  }
  return outcome;
}
