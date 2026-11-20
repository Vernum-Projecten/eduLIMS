// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The administrator's read-only view of simulations (B5: "An administrator sees each simulation
// with its teachers, its labs and the number of members, and nothing of a lab's work and no
// correct value"). The queries select only those fields and the marker of #291: no address, no
// student name, no code state and no logo.
import "@tanstack/react-start/server-only";
import type { ExpressionBuilder, Kysely, SqlBool } from "kysely";
import { storedRoleSetsWith } from "../../lib/roles.ts";
import { parseSimulationId } from "../../lib/simulations.ts";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertAdmin } from "../users/actions.ts";
import { containsPattern } from "../users/queries.ts";
import {
  DEFAULT_ADMIN_SIMULATION_PAGE_SIZE,
  type ListAdminSimulationsInput,
} from "./admin-schemas.ts";

/** One simulation as an administrator sees it (B5). */
export interface AdminSimulation {
  id: string;
  name: string;
  createdAt: string;
  /** The names of its teachers, by name. */
  teachers: string[];
  /**
   * Whether a teacher of it still holds the app role teacher, the rule of the last-teacher guard
   * (D10); `false` means nobody can manage it until an administrator restores a role (#291).
   */
  hasActiveTeacher: boolean;
  labs: { id: string; name: string; members: number }[];
}

/** One page of the administrator's list (B5, #291). */
export interface AdminSimulationPage {
  rows: AdminSimulation[];
  total: number;
  page: number;
  size: number;
}

type SimulationExpressions = ExpressionBuilder<DB, "simulations">;

/** The condition that a teacher row of the simulation has a user with the app role teacher. */
function activeTeacher(eb: SimulationExpressions) {
  return eb.exists(
    eb
      .selectFrom("simulation_teachers")
      .innerJoin("user", "user.id", "simulation_teachers.user_id")
      .select("simulation_teachers.user_id")
      .whereRef("simulation_teachers.simulation_id", "=", "simulations.id")
      .where("user.role", "in", storedRoleSetsWith("teacher")),
  );
}

/** The condition that the simulation's name contains `search`, wildcards taken literally. */
function nameMatches(eb: SimulationExpressions, search: string) {
  return eb("simulations.name", "ilike", containsPattern(search));
}

type SimulationRow = { id: string; name: string; created_at: Date; active: SqlBool };

/** Adds the teachers' names and the labs with their member counts to `simulations`. */
async function withTeachersAndLabs(
  db: Kysely<DB>,
  simulations: readonly SimulationRow[],
): Promise<AdminSimulation[]> {
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
    hasActiveTeacher: Boolean(row.active),
    labs: labs
      .filter((lab) => lab.simulation_id === row.id)
      .map((lab) => ({ id: lab.id, name: lab.name, members: Number(lab.members ?? 0) })),
  }));
}

/**
 * Returns one page of the simulations whose name contains `input.q`, newest first with the id
 * as the tie-breaker, so a page holds the same rows on every visit (B5, #291).
 *
 * @throws AuthError 403 without the admin role.
 */
export async function readAdminSimulationPage(
  db: Kysely<DB>,
  actor: Pick<SessionUser, "roles">,
  input: ListAdminSimulationsInput,
): Promise<AdminSimulationPage> {
  assertAdmin(actor);
  const page = input.page ?? 1;
  const size = input.size ?? DEFAULT_ADMIN_SIMULATION_PAGE_SIZE;
  const search = input.q?.trim();
  let base = db.selectFrom("simulations");
  if (search) base = base.where((eb) => nameMatches(eb, search));
  const [count, simulations] = await Promise.all([
    base.select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow(),
    base
      .select((eb) => [
        "simulations.id",
        "simulations.name",
        "simulations.created_at",
        activeTeacher(eb).as("active"),
      ])
      .orderBy("simulations.created_at", "desc")
      .orderBy("simulations.id", "desc")
      .limit(size)
      .offset((page - 1) * size)
      .execute(),
  ]);
  return {
    rows: await withTeachersAndLabs(db, simulations),
    total: Number(count.n),
    page,
    size,
  };
}

/**
 * Returns one simulation with the fields of {@link readAdminSimulationPage}, or `null` for a
 * malformed or unknown id (B5).
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
  const row = await db
    .selectFrom("simulations")
    .select((eb) => [
      "simulations.id",
      "simulations.name",
      "simulations.created_at",
      activeTeacher(eb).as("active"),
    ])
    .where("simulations.id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  const [simulation] = await withTeachersAndLabs(db, [row]);
  return simulation ?? null;
}

/**
 * Counts every simulation, for the overview's tile (B5, #291).
 *
 * @throws AuthError 403 without the admin role.
 */
export async function countAdminSimulations(
  db: Kysely<DB>,
  actor: Pick<SessionUser, "roles">,
): Promise<number> {
  assertAdmin(actor);
  const row = await db
    .selectFrom("simulations")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}
