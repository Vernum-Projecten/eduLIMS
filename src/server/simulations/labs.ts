// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The labs of a simulation (D10: "A teacher creates a simulation with its labs"). A lab name is
// unique within its simulation, case-insensitively; the check runs under the simulation lock and
// the database index holds it too. Deleting a lab removes its members' places, its waiting
// addresses and its code.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { type LabId, parseLabId } from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  done,
  refused,
  type SimulationActor,
  type SimulationResult,
  withLab,
  withSimulation,
} from "./access.ts";

async function nameTaken(
  trx: Kysely<DB>,
  simulationId: string,
  name: string,
  exceptLabId: string | null,
): Promise<boolean> {
  let query = trx
    .selectFrom("labs")
    .select("id")
    .where("simulation_id", "=", simulationId)
    // NOTE: #300 review; PostgreSQL's lower() on both sides, as the unique index compares, so a
    // case pair JavaScript folds differently gives `lab_name_taken`, never a unique violation.
    .where((eb) => eb(eb.fn("lower", ["name"]), "=", eb.fn("lower", [eb.val(name)])));
  if (exceptLabId !== null) query = query.where("id", "<>", exceptLabId);
  return (await query.executeTakeFirst()) !== undefined;
}

/** Creates a lab in a simulation the actor teaches; a name the simulation uses is refused. */
export function createLab(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string; name: string },
  now: Date,
): Promise<SimulationResult<{ labId: LabId }>> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const name = input.name.trim();
    if (await nameTaken(trx, simulationId, name, null)) return refused("lab_name_taken");
    const row = await trx
      .insertInto("labs")
      .values({ simulation_id: simulationId, name, created_at: now, updated_at: now })
      .returning("id")
      .executeTakeFirstOrThrow();
    const labId = parseLabId(row.id);
    if (labId === null) throw new Error("labs.id is not a UUID");
    await recordAudit(trx, {
      action: "lab_created",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "lab", id: labId },
      metadata: { simulation_id: simulationId },
    });
    return done({ labId });
  });
}

/** Renames a lab of a simulation the actor teaches; a name another lab uses is refused. */
export function renameLab(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { labId: string; name: string },
  now: Date,
): Promise<SimulationResult> {
  return withLab(db, actor, input.labId, async (trx, lab) => {
    const name = input.name.trim();
    if (await nameTaken(trx, lab.simulationId, name, lab.labId)) return refused("lab_name_taken");
    await trx
      .updateTable("labs")
      .set({ name, updated_at: now })
      .where("id", "=", lab.labId)
      .execute();
    await recordAudit(trx, {
      action: "lab_renamed",
      actor: { type: "user", id: actor.id },
      outcome: "success",
      target: { type: "lab", id: lab.labId },
      metadata: { simulation_id: lab.simulationId },
    });
    return done(null);
  });
}

/**
 * Deletes a lab of a simulation the actor teaches, with its waiting addresses and code, unless a
 * student is in it (`lab_has_students`, logged): the teacher moves or removes the students first, so
 * deleting the labs never gets round the rule of `deleteSimulation`; and unless the lab holds a
 * patient, a request, a tolerance or a Gen5 upload (`has_records`, logged).
 */
export function deleteLab(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { labId: string },
): Promise<SimulationResult> {
  return withLab(db, actor, input.labId, async (trx, lab) => {
    const event = {
      action: "lab_deleted",
      actor: { type: "user", id: actor.id },
      target: { type: "lab", id: lab.labId },
      metadata: { simulation_id: lab.simulationId },
    } as const;
    const member = await trx
      .selectFrom("lab_members")
      .select("user_id")
      .where("lab_id", "=", lab.labId)
      .limit(1)
      .executeTakeFirst();
    if (member) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "lab_has_students" });
      return refused("lab_has_students");
    }
    // NOTE: maintainer, 2026-11-20 (#268, #352); a lab's records outlive its students, so a lab
    // with a patient, a request, a tolerance or an upload is never deleted.
    const record = await trx
      .selectFrom("patients")
      .select("id")
      .where("lab_id", "=", lab.labId)
      .union(trx.selectFrom("requests").select("id").where("lab_id", "=", lab.labId))
      .union(trx.selectFrom("lab_tolerances").select("id").where("lab_id", "=", lab.labId))
      .union(trx.selectFrom("uploads").select("id").where("lab_id", "=", lab.labId))
      .limit(1)
      .executeTakeFirst();
    if (record) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "has_records" });
      return refused("has_records");
    }
    await trx.deleteFrom("labs").where("id", "=", lab.labId).execute();
    await recordAudit(trx, { ...event, outcome: "success" });
    return done(null);
  });
}
