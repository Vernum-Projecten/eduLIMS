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
  logNotFound,
  refused,
  type SimulationActor,
  type SimulationResult,
  withSimulation,
} from "./access.ts";
import { recordRemoval } from "./removals.ts";
import { dropWaitingAddressesOf } from "./waiting.ts";

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
 * simulation answers `not_found`, as an unknown or malformed one does, and the probe is logged
 * (ASVS V16.3.2).
 */
export function moveMember(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string; userId: string; labId: string },
): Promise<SimulationResult> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const labId = parseLabId(input.labId);
    const target =
      labId === null
        ? undefined
        : await trx
            .selectFrom("labs")
            .select("id")
            .where("id", "=", labId)
            .where("simulation_id", "=", simulationId)
            .executeTakeFirst();
    if (!target) {
      logNotFound(actor.id, "lab", input.labId);
      return refused("not_found");
    }
    const place = await placeOf(trx, simulationId, input.userId);
    if (!place) return refused("member_not_found");
    if (place.lab_id === target.id) return refused("same_lab");
    await trx
      .updateTable("lab_members")
      .set({ lab_id: target.id })
      .where("simulation_id", "=", simulationId)
      .where("user_id", "=", input.userId)
      .execute();
    // NOTE: #323, #330 (maintainer, 2026-11-19); an address waiting in another lab goes with the
    // move, and for an unverified email only the one in the lab the student leaves.
    const dropped = await dropWaitingAddressesOf(trx, simulationId, input.userId, {
      kind: "move",
      leftLabId: place.lab_id,
      targetLabId: target.id,
    });
    await recordAudit(trx, {
      action: "lab_member_moved",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "lab", id: target.id },
      metadata: {
        simulation_id: simulationId,
        user_id: input.userId,
        previous_lab_id: place.lab_id,
        count: dropped,
      },
    });
    return done(null);
  });
}

/**
 * Removes a student from a simulation the actor teaches, records the removal and deletes the
 * addresses that wait for them there, so neither a lab's code nor the next sign-in lets them back
 * in until a teacher adds their address again (#288, #323).
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
    // NOTE: #323, #330 (maintainer, 2026-11-19); the student's waiting address goes with them, and
    // for an unverified email (maybe a classmate's) only one in the lab the student leaves.
    const dropped = await dropWaitingAddressesOf(trx, simulationId, input.userId, {
      kind: "removal",
      leftLabId: place.lab_id,
    });
    await recordAudit(trx, {
      action: "lab_member_removed",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "lab", id: place.lab_id },
      metadata: { simulation_id: simulationId, user_id: input.userId, count: dropped },
    });
    return done(null);
  });
}
