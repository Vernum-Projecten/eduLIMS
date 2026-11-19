// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The access rule of every simulation write (D10, D11, R-01): the app role teacher, then a
// teacher row of the simulation for the session user, read in the one query that locks the
// simulation row, inside the transaction that writes. Another teacher's simulation, an unknown id
// and a malformed id all answer `not_found`, and the probe goes to the security stream.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import type { Role } from "../../lib/roles.ts";
import {
  type LabId,
  parseLabId,
  parseSimulationId,
  type SimulationId,
} from "../../lib/simulations.ts";
import { hasRole } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { AuthError } from "../middleware.ts";
import { logSecurityEvent } from "../security-log.ts";

/** Why a simulation action was refused; the screens map each code to a translated message. */
export const SIMULATION_ACTION_ERRORS = [
  "not_found",
  "lab_name_taken",
  "not_a_teacher",
  "already_teacher",
  "last_teacher",
  "teacher_not_found",
  "has_students",
  "member_not_found",
  "same_lab",
  "email_not_found",
] as const;
export type SimulationActionError = (typeof SIMULATION_ACTION_ERRORS)[number];

/** The outcome of an action: done, with an optional value, or refused with a code. */
export type SimulationResult<T = null> =
  | { ok: true; value: T }
  | { ok: false; error: SimulationActionError };

/** Returns a done result. */
export function done<T>(value: T): SimulationResult<T> {
  return { ok: true, value };
}

/** Returns a refusal. */
export function refused<T>(error: SimulationActionError): SimulationResult<T> {
  return { ok: false, error };
}

/** Who acts: the session user, never an id from the request. */
export interface SimulationActor {
  id: string;
  roles: readonly Role[];
}

/**
 * Refuses a caller without the app role teacher, whatever else they hold (ADR 0012). The
 * middleware checks first; this keeps each action safe on its own.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export function assertTeacher(actor: Pick<SimulationActor, "roles">): void {
  if (!hasRole(actor, "teacher")) throw new AuthError(403);
}

/** What a refused probe asked for: a simulation or a lab. */
export type ProbeTarget = "simulation" | "lab";

/**
 * Writes a simulation or lab the actor does not teach (or that does not exist) to the security
 * stream as `authz_fail` (ASVS V16.3.2): the actor's id and the id asked for, nothing else. A
 * malformed id is written as `redacted` by the security log.
 */
export function logNotFound(actorId: string, type: ProbeTarget, id: string): void {
  logSecurityEvent("warn", "authz_fail", {
    outcome: "refused",
    actor_type: "user",
    actor_id: actorId,
    target_type: type,
    target_id: id,
    reason: type === "simulation" ? "not_simulation_teacher" : "not_lab_teacher",
    status: 404,
  });
}

/**
 * Locks the simulation row (`FOR UPDATE`) when `userId` teaches it and returns its id, or `null`
 * when the id is malformed, unknown or another teacher's. One query: the teacher row is the
 * filter.
 */
export async function lockSimulation(
  trx: Kysely<DB>,
  simulationId: string,
  userId: string,
): Promise<SimulationId | null> {
  const id = parseSimulationId(simulationId);
  if (id === null) return null;
  const row = await trx
    .selectFrom("simulations")
    .innerJoin("simulation_teachers", "simulation_teachers.simulation_id", "simulations.id")
    .select("simulations.id")
    .where("simulations.id", "=", id)
    .where("simulation_teachers.user_id", "=", userId)
    .forUpdate("simulations")
    .executeTakeFirst();
  return row ? id : null;
}

/**
 * Runs `action` in one transaction after the simulation check: the app role teacher (403), then
 * a teacher row of the simulation for the actor (`not_found` otherwise, logged).
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function withSimulation<T>(
  db: Kysely<DB>,
  actor: SimulationActor,
  simulationId: string,
  action: (trx: Transaction<DB>, simulation: SimulationId) => Promise<SimulationResult<T>>,
): Promise<SimulationResult<T>> {
  assertTeacher(actor);
  if (parseSimulationId(simulationId) === null) {
    logNotFound(actor.id, "simulation", simulationId);
    return refused("not_found");
  }
  return db.transaction().execute(async (trx) => {
    const simulation = await lockSimulation(trx, simulationId, actor.id);
    if (simulation === null) {
      logNotFound(actor.id, "simulation", simulationId);
      return refused<T>("not_found");
    }
    return action(trx, simulation);
  });
}

/** A lab the actor teaches, with its simulation, after the simulation row is locked. */
export interface LockedLab {
  simulationId: SimulationId;
  labId: LabId;
}

/**
 * Locks the simulation of a lab the actor teaches, then reads the lab again under that lock, or
 * returns `null`. The lab is reached through its simulation's teacher rows, never on its own.
 */
export async function lockLab(
  trx: Kysely<DB>,
  labId: string,
  userId: string,
): Promise<LockedLab | null> {
  const id = parseLabId(labId);
  if (id === null) return null;
  const owner = await trx
    .selectFrom("labs")
    .innerJoin("simulations", "simulations.id", "labs.simulation_id")
    .innerJoin("simulation_teachers", "simulation_teachers.simulation_id", "simulations.id")
    .select("simulations.id")
    .where("labs.id", "=", id)
    .where("simulation_teachers.user_id", "=", userId)
    .forUpdate("simulations")
    .executeTakeFirst();
  if (!owner) return null;
  const simulationId = parseSimulationId(owner.id);
  if (simulationId === null) return null;
  // NOTE: no requirement governs this: our own design; a new statement under the lock sees a
  // lab another transaction deleted while this one waited.
  const lab = await trx
    .selectFrom("labs")
    .select("id")
    .where("id", "=", id)
    .where("simulation_id", "=", simulationId)
    .executeTakeFirst();
  return lab ? { simulationId, labId: id } : null;
}

/**
 * Runs `action` in one transaction after the lab check: the app role teacher (403), then a
 * teacher row of the lab's simulation for the actor (`not_found` otherwise, logged).
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function withLab<T>(
  db: Kysely<DB>,
  actor: SimulationActor,
  labId: string,
  action: (trx: Transaction<DB>, lab: LockedLab) => Promise<SimulationResult<T>>,
): Promise<SimulationResult<T>> {
  assertTeacher(actor);
  if (parseLabId(labId) === null) {
    logNotFound(actor.id, "lab", labId);
    return refused("not_found");
  }
  return db.transaction().execute(async (trx) => {
    const lab = await lockLab(trx, labId, actor.id);
    if (lab === null) {
      logNotFound(actor.id, "lab", labId);
      return refused<T>("not_found");
    }
    return action(trx, lab);
  });
}
