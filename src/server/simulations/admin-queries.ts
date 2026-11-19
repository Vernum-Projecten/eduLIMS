// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The administrator's read-only view of simulations (B5: "An administrator sees each simulation
// with its teachers, its labs and the number of members, and nothing of a lab's work and no
// correct value"). The queries select only those fields: no address, no student name, no code
// state and no logo.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { parseSimulationId } from "../../lib/simulations.ts";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertAdmin } from "../users/actions.ts";

/** One simulation as an administrator sees it (B5). */
export interface AdminSimulation {
  id: string;
  name: string;
  createdAt: string;
  /** The names of its teachers, by name. */
  teachers: string[];
  labs: { id: string; name: string; members: number }[];
}

async function readSimulations(db: Kysely<DB>, only: string | null): Promise<AdminSimulation[]> {
  let query = db
    .selectFrom("simulations")
    .select(["id", "name", "created_at"])
    .orderBy("created_at", "desc")
    .orderBy("id", "desc");
  if (only !== null) query = query.where("id", "=", only);
  const simulations = await query.execute();
  if (simulations.length === 0) return [];
  const ids = simulations.map((row) => row.id);
  const [teachers, labs] = await Promise.all([
    db
      .selectFrom("simulation_teachers")
      .innerJoin("user", "user.id", "simulation_teachers.user_id")
      .select(["simulation_teachers.simulation_id", "user.name"])
      .where("simulation_teachers.simulation_id", "in", ids)
      .orderBy("user.name")
      .orderBy("user.id")
      .execute(),
    db
      .selectFrom("labs")
      .select((eb) => [
        "labs.id",
        "labs.simulation_id",
        "labs.name",
        eb
          .selectFrom("lab_members")
          .select((mb) => mb.fn.countAll<string>().as("n"))
          .whereRef("lab_members.lab_id", "=", "labs.id")
          .as("members"),
      ])
      .where("labs.simulation_id", "in", ids)
      .orderBy("labs.name")
      .orderBy("labs.id")
      .execute(),
  ]);
  return simulations.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    teachers: teachers.filter((t) => t.simulation_id === row.id).map((t) => t.name),
    labs: labs
      .filter((lab) => lab.simulation_id === row.id)
      .map((lab) => ({ id: lab.id, name: lab.name, members: Number(lab.members ?? 0) })),
  }));
}

/**
 * Returns every simulation with its teachers' names and its labs with their member counts,
 * newest first (B5).
 *
 * @throws AuthError 403 without the admin role.
 */
export function readAdminSimulations(
  db: Kysely<DB>,
  actor: Pick<SessionUser, "roles">,
): Promise<AdminSimulation[]> {
  assertAdmin(actor);
  return readSimulations(db, null);
}

/**
 * Returns one simulation as {@link readAdminSimulations} does, or `null` for a malformed or
 * unknown id (B5).
 *
 * @throws AuthError 403 without the admin role.
 */
export async function readAdminSimulation(
  db: Kysely<DB>,
  actor: Pick<SessionUser, "roles">,
  simulationId: string,
): Promise<AdminSimulation | null> {
  assertAdmin(actor);
  const id = parseSimulationId(simulationId);
  if (id === null) return null;
  const [simulation] = await readSimulations(db, id);
  return simulation ?? null;
}
