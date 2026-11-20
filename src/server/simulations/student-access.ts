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
 * `null` otherwise (D10, #267: labs work only in a running simulation). The state is read in the
 * same query as the membership, and the simulation row and the student's `lab_members` row are
 * locked `FOR SHARE`. Finishing updates the simulation row (`FOR NO KEY UPDATE`), so it waits
 * until the caller's transaction ends, and no work commits in a simulation that finished after
 * this check. Removing or moving the student changes their `lab_members` row, so a write that
 * waited behind either reads the row again and finds no place in this lab.
 *
 * Call it with the transaction that writes the lab's work, as the first statement of every
 * write; outside a transaction the lock ends with the statement and protects nothing.
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
    // NOTE: security reviews of #341 (S2) and #352 (S1); FOR SHARE, which the finish's FOR NO KEY
    // UPDATE waits for, on the member row too, so a removal or move is seen on the recheck.
    .forShare(["simulations", "lab_members"])
    .executeTakeFirst();
  const simulationId = row ? parseSimulationId(row.simulation_id) : null;
  return simulationId === null ? null : { labId: id, simulationId };
}
