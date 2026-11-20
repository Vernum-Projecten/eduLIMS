// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The student's side of the access rule (S10, R-01): a student reaches a lab only through their
// own row in `lab_members`. Every student read and write of a lab's work starts from this one
// query, so the membership is the filter in SQL (#268 builds the patients and requests on it).
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import {
  type LabId,
  parseLabId,
  parseSimulationId,
  type SimulationId,
} from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";

/** A lab the session student is a member of. */
export interface StudentLab {
  labId: LabId;
  simulationId: SimulationId;
}

/**
 * Returns the query of the labs `userId` is a member of: `labs` joined to `lab_members` on the
 * session user. A caller narrows it (`where("labs.id", "=", labId)`) and selects what it needs,
 * so the membership stays part of the same query.
 */
export function studentLabsQuery(db: Kysely<DB>, userId: string) {
  return db
    .selectFrom("labs")
    .innerJoin("lab_members", (join) =>
      join
        .onRef("lab_members.lab_id", "=", "labs.id")
        .onRef("lab_members.simulation_id", "=", "labs.simulation_id"),
    )
    .where("lab_members.user_id", "=", userId);
}

/**
 * Returns the lab `labId` when `userId` is a member of it, or `null` for a malformed id, an
 * unknown lab and a lab of which the user is no member alike (S10, R-01).
 */
export async function findStudentLab(
  db: Kysely<DB>,
  userId: string,
  labId: string,
): Promise<StudentLab | null> {
  const id = parseLabId(labId);
  if (id === null) return null;
  const row = await studentLabsQuery(db, userId)
    .select(["labs.id", "labs.simulation_id"])
    .where("labs.id", "=", id)
    .executeTakeFirst();
  const simulationId = row ? parseSimulationId(row.simulation_id) : null;
  return simulationId === null ? null : { labId: id, simulationId };
}

/**
 * Returns the lab `labId` when `userId` is a member of it and its simulation is running, or
 * `null` otherwise (D10, #267: labs work only in a running simulation). Every write of a lab's
 * work starts here, so a prepared or finished simulation takes no work. The state is read in the
 * same query as the membership.
 */
export async function findWorkingStudentLab(
  db: Kysely<DB>,
  userId: string,
  labId: string,
): Promise<StudentLab | null> {
  const id = parseLabId(labId);
  if (id === null) return null;
  const row = await studentLabsQuery(db, userId)
    .innerJoin("simulations", "simulations.id", "labs.simulation_id")
    .select(["labs.id", "labs.simulation_id"])
    .where("labs.id", "=", id)
    .where("simulations.state", "=", "running")
    .executeTakeFirst();
  const simulationId = row ? parseSimulationId(row.simulation_id) : null;
  return simulationId === null ? null : { labId: id, simulationId };
}
