// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Creating, renaming and deleting a simulation (D10). The creator becomes its first teacher; every
// teacher of a simulation has the same rights. A simulation with a student in one of its labs
// cannot be deleted (our own design, #280).
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { parseSimulationId, type SimulationId } from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  assertTeacher,
  done,
  refused,
  type SimulationActor,
  type SimulationResult,
  withSimulation,
} from "./access.ts";
import { stateOf } from "./state.ts";

/**
 * Creates a simulation with the actor as its first teacher, in one transaction with its
 * `simulation_created` row.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function createSimulation(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { name: string },
  now: Date,
): Promise<SimulationResult<{ simulationId: SimulationId }>> {
  assertTeacher(actor);
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto("simulations")
      .values({ name: input.name.trim(), created_by: actor.id, created_at: now })
      .returning("id")
      .executeTakeFirstOrThrow();
    const simulationId = parseSimulationId(row.id);
    if (simulationId === null) throw new Error("simulations.id is not a UUID");
    await trx
      .insertInto("simulation_teachers")
      .values({ simulation_id: simulationId, user_id: actor.id, added_by: actor.id, added_at: now })
      .execute();
    await recordAudit(trx, {
      action: "simulation_created",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "simulation", id: simulationId },
    });
    return done({ simulationId });
  });
}

/** Renames a simulation the actor teaches. */
export function renameSimulation(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string; name: string },
): Promise<SimulationResult> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    await trx
      .updateTable("simulations")
      .set({ name: input.name.trim() })
      .where("id", "=", simulationId)
      .execute();
    await recordAudit(trx, {
      action: "simulation_renamed",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "simulation", id: simulationId },
    });
    return done(null);
  });
}

/**
 * Deletes a simulation the actor teaches, with its labs and waiting addresses, unless it runs
 * (`running`; maintainer, 2026-11-20 on #267) or a student is in one of its labs
 * (`has_students`), each refusal logged.
 */
export function deleteSimulation(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string },
): Promise<SimulationResult> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const event = {
      action: "simulation_deleted",
      actor: { type: "user", id: actor.id },
      target: { type: "simulation", id: simulationId },
    } as const;
    // NOTE: maintainer 2026-11-20 on #267; a running simulation is never deleted.
    if ((await stateOf(trx, simulationId)) === "running") {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "running" });
      return refused("running");
    }
    const member = await trx
      .selectFrom("lab_members")
      .select("user_id")
      .where("simulation_id", "=", simulationId)
      .limit(1)
      .executeTakeFirst();
    if (member) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "has_students" });
      return refused("has_students");
    }
    await trx.deleteFrom("simulations").where("id", "=", simulationId).execute();
    await recordAudit(trx, { ...event, outcome: "success" });
    return done(null);
  });
}
