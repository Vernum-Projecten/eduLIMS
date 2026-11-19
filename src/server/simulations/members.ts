// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The students of a simulation's labs (D10, S10): a teacher moves a student to another lab of the
// same simulation, or removes them from the simulation with a removal record. The composite
// foreign key keeps a move inside the simulation; the primary key keeps one lab per student.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { parseLabId } from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  done,
  refused,
  type SimulationActor,
  type SimulationResult,
  withSimulation,
} from "./access.ts";
import { recordRemoval } from "./removals.ts";

async function placeOf(trx: Kysely<DB>, simulationId: string, userId: string) {
  return trx
    .selectFrom("lab_members")
    .select("lab_id")
    .where("simulation_id", "=", simulationId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
}

/**
 * Moves a student of a simulation the actor teaches to another of its labs. A lab of another
 * simulation answers `not_found`, as an unknown one does.
 */
export function moveMember(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string; userId: string; labId: string },
): Promise<SimulationResult> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const labId = parseLabId(input.labId);
    if (labId === null) return refused("not_found");
    const target = await trx
      .selectFrom("labs")
      .select("id")
      .where("id", "=", labId)
      .where("simulation_id", "=", simulationId)
      .executeTakeFirst();
    if (!target) return refused("not_found");
    const place = await placeOf(trx, simulationId, input.userId);
    if (!place) return refused("member_not_found");
    if (place.lab_id === target.id) return refused("same_lab");
    await trx
      .updateTable("lab_members")
      .set({ lab_id: target.id })
      .where("simulation_id", "=", simulationId)
      .where("user_id", "=", input.userId)
      .execute();
    await recordAudit(trx, {
      action: "lab_member_moved",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "lab", id: target.id },
      metadata: {
        simulation_id: simulationId,
        user_id: input.userId,
        previous_lab_id: place.lab_id,
      },
    });
    return done(null);
  });
}

/**
 * Removes a student from a simulation the actor teaches and records the removal, so the lab's
 * code no longer lets them back in (#288).
 */
export function removeMember(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string; userId: string },
  now: Date,
): Promise<SimulationResult> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const place = await placeOf(trx, simulationId, input.userId);
    if (!place) return refused("member_not_found");
    await trx
      .deleteFrom("lab_members")
      .where("simulation_id", "=", simulationId)
      .where("user_id", "=", input.userId)
      .execute();
    await recordRemoval(trx, simulationId, input.userId, actor.id, now);
    await recordAudit(trx, {
      action: "lab_member_removed",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "lab", id: place.lab_id },
      metadata: { simulation_id: simulationId, user_id: input.userId },
    });
    return done(null);
  });
}
