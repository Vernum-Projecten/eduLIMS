// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The state of a simulation (D10, #267): prepared, running, finished, and never back. A teacher of
// the simulation starts and finishes it, at the server's time (Q-SIM-2). Labs work only while it
// runs; the correct values stay changeable in every state.
import "@tanstack/react-start/server-only";
import { type Kysely, sql } from "kysely";
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
  type SimulationActionError,
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
 * Returns the ids of the tests that have a correct value in the simulation but no accuracy
 * limits there, ordered by id. Read under the simulation lock, which every write of a value or
 * a limit takes too, so the answer holds until the caller commits.
 */
export async function testsWithoutLimits(
  db: Kysely<DB>,
  simulationId: SimulationId,
): Promise<string[]> {
  const rows = await db
    .selectFrom("correct_values as cv")
    .leftJoin("simulation_test_limits as l", (join) =>
      join.onRef("l.test_id", "=", "cv.test_id").onRef("l.simulation_id", "=", "cv.simulation_id"),
    )
    .select("cv.test_id")
    .distinct()
    .where("cv.simulation_id", "=", simulationId)
    .where("l.test_id", "is", null)
    .orderBy("cv.test_id")
    .execute();
  return rows.map((row) => row.test_id);
}

/**
 * Returns whether a simulation other than `simulationId` runs (D11, #386: one at a time). It
 * says nothing about which one, so no refusal names another teacher's simulation.
 */
export async function anotherRunning(db: Kysely<DB>, simulationId: SimulationId): Promise<boolean> {
  const row = await db
    .selectFrom("simulations")
    .select("id")
    .where("state", "=", "running")
    .where("id", "<>", simulationId)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Why a simulation cannot start yet: a refusal code of {@link startSimulation}, and for
 * `missing_limits` the tests it is about.
 */
export interface StartRefusal {
  error: Extract<
    SimulationActionError,
    "not_prepared" | "another_running" | "no_students" | "no_correct_values" | "missing_limits"
  >;
  testIds?: readonly string[];
}

/** What the start of a simulation depends on, read in one place for the start and the overview. */
export interface StartFacts {
  state: SimulationState;
  /** The students in all labs of the simulation together. */
  students: number;
  /** The correct values of the simulation. */
  correctValues: number;
  /** The tests with a correct value but no accuracy limits, by id. */
  missingLimits: readonly string[];
  /** Whether another simulation runs (#386). */
  anotherRunning: boolean;
}

/**
 * Returns why a simulation cannot start, or `null` when it can. The start and the overview's
 * checklist both ask this one rule, so the checklist shows the reason the start would give
 * (#381). The first reason that holds wins: the state, then another running simulation (only one
 * runs at a time, owner 2026-11-20, #386), then a student in a lab, then a correct value, then
 * the limits of every test with one.
 */
export function startRefusal(facts: StartFacts): StartRefusal | null {
  if (facts.state !== "prepared") return { error: "not_prepared" };
  if (facts.anotherRunning) return { error: "another_running" };
  // NOTE: owner via coordinator 2026-11-20 on #394; a lab with a student and a correct value first.
  if (facts.students === 0) return { error: "no_students" };
  if (facts.correctValues === 0) return { error: "no_correct_values" };
  // NOTE: maintainer 2026-11-20 on #267; every test with a correct value has its limits first.
  if (facts.missingLimits.length > 0) {
    return { error: "missing_limits", testIds: facts.missingLimits };
  }
  return null;
}

/**
 * Reads the {@link StartFacts} of a simulation in `state`. Inside the start's transaction it runs
 * under the simulation lock, which every write of a member, a value or a limit takes too, so the
 * answer holds until the start commits.
 */
export async function startFacts(
  db: Kysely<DB>,
  simulationId: SimulationId,
  state: SimulationState,
): Promise<StartFacts> {
  // One query after the other: inside a transaction they share one connection.
  // NOTE: security review of #403 (N2); the places are locked FOR SHARE, after the simulation
  // row: an account deletion locks the student's places first and no simulation row, so a start
  // that waits on it counts without the deleted student.
  const places = await db
    .selectFrom("lab_members")
    .select("user_id")
    .where("simulation_id", "=", simulationId)
    .orderBy("user_id")
    .forShare()
    .execute();
  const values = await db
    .selectFrom("correct_values")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("simulation_id", "=", simulationId)
    .executeTakeFirstOrThrow();
  const missingLimits = await testsWithoutLimits(db, simulationId);
  return {
    state,
    students: places.length,
    correctValues: Number(values.n),
    missingLimits,
    anotherRunning: await anotherRunning(db, simulationId),
  };
}

/** The partial unique index of migration 0030: at most one running simulation (#386). */
const ONE_RUNNING_INDEX = "simulations_one_running";

/** Returns whether `error` is the unique violation of the one-running index of migration 0030. */
export function isOneRunningViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "code") === "23505" &&
    Reflect.get(error, "constraint") === ONE_RUNNING_INDEX
  );
}

/**
 * Sets the simulation running inside a savepoint, and returns `false` when the index of
 * migration 0030 refuses it: another start committed after this one's check (#386). The
 * savepoint keeps the transaction usable, so the refusal is logged in it.
 */
async function markRunning(
  trx: Kysely<DB>,
  simulationId: SimulationId,
  now: Date,
): Promise<boolean> {
  await sql`savepoint simulation_start`.execute(trx);
  try {
    await trx
      .updateTable("simulations")
      .set({ state: "running", started_at: now })
      .where("id", "=", simulationId)
      .execute();
  } catch (error) {
    if (!isOneRunningViolation(error)) throw error;
    await sql`rollback to savepoint simulation_start`.execute(trx);
    return false;
  }
  await sql`release savepoint simulation_start`.execute(trx);
  return true;
}

/**
 * Starts a prepared simulation the actor teaches. Only one simulation runs at a time
 * (`another_running`, owner 2026-11-20 on #386); the index of migration 0030 holds it when two
 * starts race. Every test with a correct value needs its accuracy limits first (`missing_limits`, with the ids of the tests without them; maintainer,
 * 2026-11-20 on #267). The catalogue tests its correct values name
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
    const state = await stateOf(trx, simulationId);
    const blocked = startRefusal(await startFacts(trx, simulationId, state));
    if (blocked !== null) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: blocked.error });
      return refused(blocked.error, blocked.testIds);
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
    if (!(await markRunning(trx, simulationId, now))) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: "another_running" });
      return refused("another_running");
    }
    await recordAudit(trx, { ...event, outcome: "success" });
    return done(null);
  });
}

/**
 * Finishes a running simulation the actor teaches. Labs stop working; the correct values stay
 * changeable. Its labs' join codes are deleted, with their count on the log row (review of
 * #392). Another state is refused with `not_running`, logged.
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
    // NOTE: maintainer on the review of #392 (N2); a finished simulation takes no new student, so
    // its labs' codes go, under the simulation lock that every code write takes first.
    const codes = await trx
      .deleteFrom("lab_join_codes")
      .where("lab_id", "in", (eb) =>
        eb.selectFrom("labs").select("labs.id").where("labs.simulation_id", "=", simulationId),
      )
      .executeTakeFirst();
    await recordAudit(trx, {
      ...event,
      outcome: "success",
      metadata: { count: Number(codes.numDeletedRows) },
    });
    return done(null);
  });
}
