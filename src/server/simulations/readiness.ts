// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The preparation of a simulation as its overview shows it (D10, #381): which steps are done, and
// whether the start would be refused and why. Teacher-scoped like every simulation read (D11): the
// teacher row of the session user is part of the query, and anyone else reads nothing.
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
import { parseSimulationId, type SimulationState } from "../../lib/simulations.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertTeacher, logNotFound, type SimulationActor } from "./access.ts";
import { type StartRefusal, startRefusal, toSimulationState } from "./state.ts";

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
 * rule the start itself applies. The teacher row and every count are one statement, so the
 * checklist sees one snapshot (PostgreSQL gives a statement one), and a teacher removed before
 * it ran reads nothing (security review of #394).
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
  const row = await db
    .selectFrom("simulations as s")
    .innerJoin("simulation_teachers as mine", "mine.simulation_id", "s.id")
    .select((eb) => [
      "s.id",
      "s.state",
      "s.started_at",
      "s.finished_at",
      eb
        .selectFrom("labs")
        .select((lb) => lb.fn.countAll<string>().as("n"))
        .whereRef("labs.simulation_id", "=", "s.id")
        .as("labs"),
      eb
        .selectFrom("labs")
        .select((lb) => lb.fn.countAll<string>().as("n"))
        .whereRef("labs.simulation_id", "=", "s.id")
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom("lab_members")
                .select("lab_members.user_id")
                .whereRef("lab_members.lab_id", "=", "labs.id"),
            ),
          ),
        )
        .as("empty_labs"),
      eb
        .selectFrom("lab_members")
        .select((mb) => mb.fn.countAll<string>().as("n"))
        .whereRef("lab_members.simulation_id", "=", "s.id")
        .as("students"),
      eb
        .selectFrom("lab_member_emails")
        .select((wb) => wb.fn.countAll<string>().as("n"))
        .whereRef("lab_member_emails.simulation_id", "=", "s.id")
        .as("waiting"),
      eb
        .selectFrom("correct_values")
        .select((cb) => cb.fn.countAll<string>().as("n"))
        .whereRef("correct_values.simulation_id", "=", "s.id")
        .as("values"),
      eb
        .selectFrom("correct_values")
        .select((cb) => cb.fn.count<string>("correct_values.test_id").distinct().as("n"))
        .whereRef("correct_values.simulation_id", "=", "s.id")
        .as("tests"),
      // NOTE: the rule of testsWithoutLimits (state.ts), inside this one statement.
      sql<unknown>`(
        select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name)
          order by t.name, t.id), '[]'::json)
        from catalogue_tests t
        where t.id in (
          select cv.test_id from correct_values cv
          left join simulation_test_limits l
            on l.test_id = cv.test_id and l.simulation_id = cv.simulation_id
          where cv.simulation_id = s.id and l.test_id is null
        )
      )`.as("missing"),
    ])
    .where("s.id", "=", id)
    .where("mine.user_id", "=", actor.id)
    .executeTakeFirst();
  if (!row) {
    logNotFound(actor.id, "simulation", simulationId);
    return null;
  }
  const state = toSimulationState(row.state);
  const students = Number(row.students ?? 0);
  const values = Number(row.values ?? 0);
  const missing = parseMissing(row.missing);
  return {
    simulationId: row.id,
    state,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    labs: {
      count: Number(row.labs ?? 0),
      empty: Number(row.empty_labs ?? 0),
      students,
      waiting: Number(row.waiting ?? 0),
    },
    values: { count: values, tests: Number(row.tests ?? 0) },
    missingLimits: missing,
    startRefusal: startRefusal({
      state,
      students,
      correctValues: values,
      // Ordered by id, as the start's own read orders them.
      missingLimits: missing.map((test) => test.id).sort(),
    }),
  };
}

/**
 * Returns the tests without limits the statement built as JSON.
 *
 * @throws Error when it is not a list of `{ id, name }` (fail loud: the statement writes it).
 */
function parseMissing(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) throw new Error("readiness: missing limits is not a list");
  return value.map((item: unknown) => {
    const id: unknown = typeof item === "object" && item !== null ? Reflect.get(item, "id") : null;
    const name: unknown =
      typeof item === "object" && item !== null ? Reflect.get(item, "name") : null;
    if (typeof id !== "string" || typeof name !== "string") {
      throw new Error("readiness: a missing-limits entry is not { id, name }");
    }
    return { id, name };
  });
}
