// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The state of a simulation (D10, #267): prepared, running, finished, and never back. A teacher of
// the simulation starts and finishes it, at the server's time (Q-SIM-2). Labs work only while it
// runs; the correct values stay changeable in every state.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import {
  parseSimulationState,
  type SimulationId,
  type SimulationState,
} from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  done,
  refused,
  type SimulationActor,
  type SimulationResult,
  withSimulation,
} from "./access.ts";

/**
 * Returns the state of a simulation, read inside the caller's transaction.
 *
 * @throws Error when the stored state is none of {@link SimulationState} (the CHECK holds it).
 */
export async function stateOf(
  db: Kysely<DB>,
  simulationId: SimulationId,
): Promise<SimulationState> {
  const row = await db
    .selectFrom("simulations")
    .select("state")
    .where("id", "=", simulationId)
    .executeTakeFirstOrThrow();
  return toSimulationState(row.state);
}

/**
 * Returns a stored state as a {@link SimulationState}.
 *
 * @throws Error when it is none (fail loud: the CHECK of migration 0018 holds the same list).
 */
export function toSimulationState(stored: string): SimulationState {
  const state = parseSimulationState(stored);
  if (state === undefined) throw new Error("simulations.state is not a known state");
  return state;
}

/**
 * Starts a prepared simulation the actor teaches. The catalogue tests its correct values name
 * are locked `FOR SHARE` until the start commits, so a catalogue edit that a running simulation
 * forbids waits for the start and is then refused (D9). Another state is refused with
 * `not_prepared`, logged.
 */
export function startSimulation(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string },
  now: Date,
): Promise<SimulationResult> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const event = {
      action: "simulation_started",
      actor: { type: "user", id: actor.id },
      target: { type: "simulation", id: simulationId },
    } as const;
    if ((await stateOf(trx, simulationId)) !== "prepared") {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "not_prepared" });
      return refused("not_prepared");
    }
    // NOTE: security note on #268; ordered by id, so two starts that share tests lock them alike.
    await trx
      .selectFrom("catalogue_tests")
      .select("id")
      .where("id", "in", (eb) =>
        eb
          .selectFrom("correct_values")
          .select("correct_values.test_id")
          .where("correct_values.simulation_id", "=", simulationId),
      )
      .orderBy("id")
      .forShare()
      .execute();
    await trx
      .updateTable("simulations")
      .set({ state: "running", started_at: now })
      .where("id", "=", simulationId)
      .execute();
    await recordAudit(trx, { ...event, outcome: "success" });
    return done(null);
  });
}

/**
 * Finishes a running simulation the actor teaches. Labs stop working; the correct values stay
 * changeable. Another state is refused with `not_running`, logged.
 */
export function finishSimulation(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string },
  now: Date,
): Promise<SimulationResult> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const event = {
      action: "simulation_finished",
      actor: { type: "user", id: actor.id },
      target: { type: "simulation", id: simulationId },
    } as const;
    if ((await stateOf(trx, simulationId)) !== "running") {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "not_running" });
      return refused("not_running");
    }
    await trx
      .updateTable("simulations")
      .set({ state: "finished", finished_at: now })
      .where("id", "=", simulationId)
      .execute();
    await recordAudit(trx, { ...event, outcome: "success" });
    return done(null);
  });
}
