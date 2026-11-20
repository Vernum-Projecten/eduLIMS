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
import { inOtherActiveSimulation } from "./one-simulation.ts";
import { recordRemoval } from "./removals.ts";
import { stateOf } from "./state.ts";
import { dropWaitingAddressesOf } from "./waiting.ts";

async function placeOf(
  trx: Kysely<DB>,
  simulationId: string,
  userId: string,
  options: { lock?: boolean } = {},
) {
  const query = trx
    .selectFrom("lab_members")
    .select("lab_id")
    .where("simulation_id", "=", simulationId)
    .where("user_id", "=", userId);
  return (options.lock ? query.forNoKeyUpdate() : query).executeTakeFirst();
}

/**
 * Moves a student of a simulation the actor teaches to another of its labs. A lab of another
 * simulation answers `not_found`, as an unknown or malformed one does, and the probe is logged
 * (ASVS V16.3.2). A finished simulation is `not_running`, and a student in a lab of another
 * prepared or running simulation is `in_other_simulation`, both logged (#379, review of #392).
 * The locks go simulation, then the student's place, then the student's user row.
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
    const event = {
      action: "lab_member_moved",
      actor: { type: "user", id: actor.id },
      target: { type: "lab", id: target.id },
    } as const;
    // NOTE: maintainer on the review of #392 (N1); a finished simulation is history, so no move.
    if ((await stateOf(trx, simulationId)) === "finished") {
      await recordAudit(trx, {
        ...event,
        outcome: "refused",
        reason: "not_running",
        metadata: { simulation_id: simulationId, user_id: input.userId },
      });
      return refused("not_running");
    }
    // NOTE: security review of #392 (S1); the place before the user row, as a deletion takes them.
    const place = await placeOf(trx, simulationId, input.userId, { lock: true });
    if (!place) return refused("member_not_found");
    if (place.lab_id === target.id) return refused("same_lab");
    const metadata = {
      simulation_id: simulationId,
      user_id: input.userId,
      previous_lab_id: place.lab_id,
    };
    // NOTE: #379 (owner, 2026-11-20); a move puts the student in a lab too, so it keeps the rule.
    if (await inOtherActiveSimulation(trx, input.userId, simulationId)) {
      await recordAudit(trx, {
        ...event,
        outcome: "refused",
        reason: "in_other_simulation",
        metadata,
      });
      return refused("in_other_simulation");
    }
    const moved = await trx
      .updateTable("lab_members")
      .set({ lab_id: target.id })
      .where("simulation_id", "=", simulationId)
      .where("user_id", "=", input.userId)
      .executeTakeFirst();
    if (Number(moved.numUpdatedRows) === 0) return refused("member_not_found");
    // NOTE: #323, #330 (maintainer, 2026-11-20); an address waiting in another lab goes with the
    // move, for a verified email only: an unverified one may be a classmate's.
    const dropped = await dropWaitingAddressesOf(trx, simulationId, input.userId, {
      exceptLabId: target.id,
    });
    await recordAudit(trx, {
      ...event,
      outcome: "success",
      metadata: { ...metadata, count: dropped },
    });
    return done(null);
  });
}

/**
 * Removes a student from a simulation the actor teaches, records the removal and deletes the
 * address that waits for their verified email there. Neither a lab's code nor the next sign-in lets
 * them back in until a teacher adds their address again (#288, #323, #330).
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
    // NOTE: #323, #330 (maintainer, 2026-11-20); the waiting address of a verified email goes with
    // the student; an unverified one may be a classmate's and stays, and the link refuses them.
    const dropped = await dropWaitingAddressesOf(trx, simulationId, input.userId);
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
