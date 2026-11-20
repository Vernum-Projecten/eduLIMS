// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Which simulation the teacher dashboard shows (D11, #386): the one running simulation, to its
// teachers only. The teacher row of the session user is part of the query, so a teacher who does
// not teach it learns only that it is not theirs, never its name.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema.gen.ts";
import { assertTeacher, type SimulationActor } from "../simulations/access.ts";

/** The running simulation as the dashboard sees it, or why it shows none. */
export type RunningSimulation =
  | { kind: "none" }
  | { kind: "not_taught" }
  | { kind: "running"; simulation: { id: string; name: string; startedAt: string } };

/**
 * Returns the running simulation when the actor teaches it, `none` when no simulation runs, and
 * `not_taught` when one runs that the actor does not teach.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function readRunningSimulation(
  db: Kysely<DB>,
  actor: SimulationActor,
): Promise<RunningSimulation> {
  assertTeacher(actor);
  const running = await db
    .selectFrom("simulations as s")
    .leftJoin("simulation_teachers as mine", (join) =>
      join.onRef("mine.simulation_id", "=", "s.id").on("mine.user_id", "=", actor.id),
    )
    .select(["s.id", "s.name", "s.started_at", "mine.user_id"])
    .where("s.state", "=", "running")
    .executeTakeFirst();
  if (!running) return { kind: "none" };
  if (running.user_id === null || running.started_at === null) return { kind: "not_taught" };
  return {
    kind: "running",
    simulation: { id: running.id, name: running.name, startedAt: running.started_at.toISOString() },
  };
}
