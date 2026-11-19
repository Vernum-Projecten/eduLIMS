// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The teachers of a simulation (D10: "A teacher can add other teachers to a simulation, with the
// same rights"). A teacher is added by the address of an existing account with the app role
// teacher; the last teacher of a simulation is never removed.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { validateRoleValue } from "../../lib/roles.ts";
import { normalizeEmail } from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  done,
  refused,
  type SimulationActor,
  type SimulationResult,
  withSimulation,
} from "./access.ts";
import { storedEmailIsAscii } from "./ascii-email.ts";

/**
 * Adds the account with address `email` as a teacher of a simulation the actor teaches. An
 * unknown address, an account whose stored address is not plain ASCII and an account without the
 * app role teacher get the same `not_a_teacher`.
 */
export function addTeacher(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string; email: string },
  now: Date,
): Promise<SimulationResult<{ userId: string }>> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const event = {
      action: "simulation_teacher_added",
      actor: { type: "user", id: actor.id },
      target: { type: "simulation", id: simulationId },
    } as const;
    const account = await trx
      .selectFrom("user")
      .select(["id", "role"])
      .where((eb) => eb(eb.fn("lower", ["email"]), "=", normalizeEmail(input.email)))
      .where(storedEmailIsAscii())
      .executeTakeFirst();
    const parsed = account ? validateRoleValue(account.role) : null;
    if (!account || !parsed?.ok || !parsed.roles.includes("teacher")) {
      // NOTE: #280; the refusal row names no account, so the log does not tell which reason.
      await recordAudit(trx, { ...event, outcome: "refused", reason: "not_a_teacher" });
      return refused("not_a_teacher");
    }
    const inserted = await trx
      .insertInto("simulation_teachers")
      .values({
        simulation_id: simulationId,
        user_id: account.id,
        added_by: actor.id,
        added_at: now,
      })
      .onConflict((oc) => oc.columns(["simulation_id", "user_id"]).doNothing())
      .returning("user_id")
      .executeTakeFirst();
    if (!inserted) return refused("already_teacher");
    await recordAudit(trx, { ...event, outcome: "success", metadata: { user_id: account.id } });
    return done({ userId: account.id });
  });
}

/** The constraint trigger of migration 0012 that keeps one teacher row per simulation. */
export const LAST_TEACHER_CONSTRAINT = "simulation_teachers_last_teacher";

/** Returns whether a database error is the refusal of {@link LAST_TEACHER_CONSTRAINT}. */
export function isLastTeacherViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (
    Reflect.get(error, "code") === "23514" &&
    Reflect.get(error, "constraint") === LAST_TEACHER_CONSTRAINT
  );
}

function holdsTeacherRole(stored: string | null): boolean {
  const parsed = validateRoleValue(stored);
  return parsed.ok && parsed.roles.includes("teacher");
}

/**
 * Removes a teacher from a simulation the actor teaches, unless no other teacher row with a user
 * who still holds the app role teacher stays (`last_teacher`, logged). A teacher may remove
 * themselves while another teacher stays. The other teachers' user rows are read `FOR SHARE`
 * under the simulation lock, so a role change or a deletion cannot slip in between; the deferred
 * trigger {@link LAST_TEACHER_CONSTRAINT} holds the last row at commit too.
 */
export async function removeTeacher(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string; userId: string },
): Promise<SimulationResult> {
  try {
    return await withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
      const teachers = await trx
        .selectFrom("simulation_teachers")
        .innerJoin("user", "user.id", "simulation_teachers.user_id")
        .select(["simulation_teachers.user_id", "user.role"])
        .where("simulation_teachers.simulation_id", "=", simulationId)
        .forShare("user")
        .execute();
      if (!teachers.some((row) => row.user_id === input.userId)) {
        return refused("teacher_not_found");
      }
      const event = {
        action: "simulation_teacher_removed",
        actor: { type: "user", id: actor.id },
        target: { type: "simulation", id: simulationId },
        metadata: { user_id: input.userId },
      } as const;
      // NOTE: #300 review (maintainer, 2026-11-19); a row whose user lost the app role teacher
      // does not count, so the simulation never keeps only former teachers.
      const staying = teachers.filter(
        (row) => row.user_id !== input.userId && holdsTeacherRole(row.role),
      );
      if (staying.length === 0) {
        await recordAudit(trx, { ...event, outcome: "refused", reason: "last_teacher" });
        return refused("last_teacher");
      }
      await trx
        .deleteFrom("simulation_teachers")
        .where("simulation_id", "=", simulationId)
        .where("user_id", "=", input.userId)
        .execute();
      await recordAudit(trx, { ...event, outcome: "success" });
      return done(null);
    });
  } catch (error) {
    if (isLastTeacherViolation(error)) return refused("last_teacher");
    throw error;
  }
}
