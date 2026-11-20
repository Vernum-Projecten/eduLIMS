// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The preparation of a simulation as its overview shows it (D10, #381): which steps are done, and
// whether the start would be refused and why. Teacher-scoped like every simulation read (D11): the
// teacher row of the session user is part of the query, and anyone else reads nothing.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { parseSimulationId, type SimulationState } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertTeacher, logNotFound, type SimulationActor } from "./access.ts";
import {
  anotherRunning,
  type StartRefusal,
  startRefusal,
  testsWithoutLimits,
  toSimulationState,
} from "./state.ts";

/** The preparation of one simulation: counts per step and the start's verdict. */
export interface SimulationReadiness {
  simulationId: string;
  state: SimulationState;
  startedAt: string | null;
  finishedAt: string | null;
  labs: {
    /** The labs of the simulation. */
    count: number;
    /** The labs with no student in them yet. */
    empty: number;
    /** The students in all labs together. */
    students: number;
    /** The addresses that wait for a student to sign in, in all labs together. */
    waiting: number;
  };
  values: {
    /** The correct values entered. */
    count: number;
    /** The tests those values are for. */
    tests: number;
  };
  /** The tests with a correct value but no accuracy limits, by name: what blocks the start. */
  missingLimits: { id: string; name: string }[];
  /** `null` when the start would succeed now; the refusal it would give otherwise. */
  startRefusal: StartRefusal | null;
}

/**
 * Returns the preparation of a simulation the actor teaches, or `null` for a malformed id, an
 * unknown simulation and another teacher's simulation alike (D11); every `null` is logged as an
 * `authz_fail` probe (ASVS V16.3.2). The start's verdict comes from {@link startRefusal}, the
 * rule the start itself applies.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function getSimulationReadiness(
  db: Kysely<DB>,
  actor: SimulationActor,
  simulationId: string,
): Promise<SimulationReadiness | null> {
  assertTeacher(actor);
  const id = parseSimulationId(simulationId);
  if (id === null) {
    logNotFound(actor.id, "simulation", simulationId);
    return null;
  }
  const simulation = await db
    .selectFrom("simulations as s")
    .innerJoin("simulation_teachers as mine", "mine.simulation_id", "s.id")
    .select(["s.id", "s.state", "s.started_at", "s.finished_at"])
    .where("s.id", "=", id)
    .where("mine.user_id", "=", actor.id)
    .executeTakeFirst();
  if (!simulation) {
    logNotFound(actor.id, "simulation", simulationId);
    return null;
  }
  const [labs, values, missing, otherRunning] = await Promise.all([
    db
      .selectFrom("labs")
      .select((eb) => [
        "labs.id",
        eb
          .selectFrom("lab_members")
          .select((mb) => mb.fn.countAll<string>().as("n"))
          .whereRef("lab_members.lab_id", "=", "labs.id")
          .as("members"),
        eb
          .selectFrom("lab_member_emails")
          .select((wb) => wb.fn.countAll<string>().as("n"))
          .whereRef("lab_member_emails.lab_id", "=", "labs.id")
          .as("waiting"),
      ])
      .where("labs.simulation_id", "=", id)
      .execute(),
    db
      .selectFrom("correct_values")
      .select((eb) => [
        eb.fn.countAll<string>().as("values"),
        eb.fn.count<string>("test_id").distinct().as("tests"),
      ])
      .where("simulation_id", "=", id)
      .executeTakeFirstOrThrow(),
    testsWithoutLimits(db, id),
    anotherRunning(db, id),
  ]);
  const names =
    missing.length === 0
      ? []
      : await db
          .selectFrom("catalogue_tests")
          .select(["id", "name"])
          .where("id", "in", missing)
          .orderBy("name")
          .orderBy("id")
          .execute();
  const state = toSimulationState(simulation.state);
  const members = labs.map((lab) => Number(lab.members ?? 0));
  return {
    simulationId: simulation.id,
    state,
    startedAt: simulation.started_at?.toISOString() ?? null,
    finishedAt: simulation.finished_at?.toISOString() ?? null,
    labs: {
      count: labs.length,
      empty: members.filter((n) => n === 0).length,
      students: members.reduce((sum, n) => sum + n, 0),
      waiting: labs.reduce((sum, lab) => sum + Number(lab.waiting ?? 0), 0),
    },
    values: { count: Number(values.values), tests: Number(values.tests) },
    missingLimits: names.map((row) => ({ id: row.id, name: row.name })),
    startRefusal: startRefusal({
      state,
      missingLimits: missing,
      anotherRunning: state === "prepared" && otherRunning,
    }),
  };
}
