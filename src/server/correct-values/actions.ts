// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Writing correct values and accuracy limits (D10, D13, #267). Every write runs under the
// simulation lock of `withSimulation`: the app role teacher, then a teacher row of the simulation
// for the session user, in SQL. A correct value changes in any state of the simulation, and every
// change leaves an activity-log row with ids only, never the value (B4, Q-SIM-1).
import "@tanstack/react-start/server-only";
import { type Kysely, sql, type Transaction } from "kysely";
import type { LimitKind } from "../../lib/correct-values.ts";
import { compareDecimals } from "../../lib/decimal.ts";
import type { SimulationId } from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  done,
  logNotFound,
  refused,
  type SimulationActor,
  type SimulationResult,
  withSimulation,
} from "../simulations/access.ts";
import { stateOf } from "../simulations/state.ts";
import type { CorrectValueRow } from "./schemas.ts";

/** How many rows of an entry were new, changed or already held that value. */
export interface SetCorrectValuesOutcome {
  added: number;
  changed: number;
  unchanged: number;
}

/**
 * Returns the tests of `testIds` without limits in the simulation when it runs, ordered by id; an
 * empty list when it does not run. Read under the simulation lock that every limit write takes.
 */
async function runningWithoutLimits(
  trx: Transaction<DB>,
  simulationId: SimulationId,
  testIds: readonly string[],
): Promise<string[]> {
  if ((await stateOf(trx, simulationId)) !== "running") return [];
  const limited = await trx
    .selectFrom("simulation_test_limits")
    .select("test_id")
    .where("simulation_id", "=", simulationId)
    .where("test_id", "in", testIds)
    .execute();
  const has = new Set(limited.map((row) => row.test_id));
  return testIds.filter((id) => !has.has(id)).sort((a, b) => a.localeCompare(b));
}

/** A stored correct value, keyed by the database's own lower case of its sample number. */
interface StoredValue {
  id: string;
  value: string;
}

/** Returns PostgreSQL's `lower()` of each sample number, so keys match the unique index. */
async function lowerKeys(trx: Transaction<DB>, sampleNumbers: readonly string[]) {
  const result = await sql<{ key: string; position: string }>`
    select lower(t.sample_number) as key, t.position
      from unnest(${sampleNumbers}::text[]) with ordinality as t(sample_number, position)
      order by t.position`.execute(trx);
  return result.rows.map((row) => row.key);
}

/**
 * Refuses a test that is not in the catalogue (`test_not_found`), and a retired test that this
 * simulation does not use yet (`test_retired`): a retired test is offered to no new simulation
 * (D9), while the values a simulation already has for it stay changeable. The tests are read
 * `FOR SHARE` in id order.
 */
async function testRefusal(
  trx: Transaction<DB>,
  simulationId: SimulationId,
  testIds: readonly string[],
): Promise<"test_not_found" | "test_retired" | null> {
  const tests = await trx
    .selectFrom("catalogue_tests")
    .select((eb) => [
      "catalogue_tests.id",
      "catalogue_tests.retired_at",
      eb
        .exists(
          eb
            .selectFrom("correct_values")
            .select("correct_values.id")
            .whereRef("correct_values.test_id", "=", "catalogue_tests.id")
            .where("correct_values.simulation_id", "=", simulationId),
        )
        .as("in_use"),
    ])
    .where("catalogue_tests.id", "in", testIds)
    // NOTE: security review of #341 (S4); conflicts with retireTest's FOR UPDATE, so a first value
    // for a test being retired waits for the retirement and is then refused.
    .orderBy("catalogue_tests.id")
    .forShare("catalogue_tests")
    .execute();
  if (tests.length !== testIds.length) return "test_not_found";
  if (tests.some((test) => test.retired_at !== null && !test.in_use)) return "test_retired";
  return null;
}

/**
 * Sets correct values in a simulation the actor teaches: a new sample number and test is added
 * (`simulation_value_set`), a known one takes the new value (`simulation_value_changed`), and an
 * unchanged value writes nothing, compared as decimals ("5.20" equals "5.2"). The sample number
 * matches regardless of case. A lab plays no part: every lab is judged against these values
 * (D10). While the simulation runs, a value for a test without limits is refused
 * (`missing_limits`, with the test ids; maintainer, 2026-11-20 on #341).
 */
export function setCorrectValues(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string; rows: readonly CorrectValueRow[] },
  now: Date,
): Promise<SimulationResult<SetCorrectValuesOutcome>> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const testIds = [...new Set(input.rows.map((row) => row.testId))];
    const refusal = await testRefusal(trx, simulationId, testIds);
    if (refusal !== null) {
      await recordAudit(trx, {
        action: "simulation_value_set",
        actor: { type: "user", id: actor.id },
        target: { type: "simulation", id: simulationId },
        outcome: "refused",
        reason: refusal,
      });
      return refused(refusal);
    }
    const unlimited = await runningWithoutLimits(trx, simulationId, testIds);
    if (unlimited.length > 0) {
      await recordAudit(trx, {
        action: "simulation_value_set",
        actor: { type: "user", id: actor.id },
        target: { type: "simulation", id: simulationId },
        outcome: "refused",
        reason: "missing_limits",
      });
      return refused("missing_limits", unlimited);
    }
    const stored = await trx
      .selectFrom("correct_values")
      .select((eb) => [
        "id",
        "test_id",
        eb.fn<string>("lower", ["sample_number"]).as("key"),
        sql<string>`value::text`.as("value"),
      ])
      .where("simulation_id", "=", simulationId)
      .where("test_id", "in", testIds)
      .execute();
    const known = new Map<string, StoredValue>(
      stored.map((row) => [`${row.key}\u0000${row.test_id}`, { id: row.id, value: row.value }]),
    );
    const keys = await lowerKeys(
      trx,
      input.rows.map((row) => row.sampleNumber),
    );
    const outcome: SetCorrectValuesOutcome = { added: 0, changed: 0, unchanged: 0 };
    for (const [index, row] of input.rows.entries()) {
      const key = `${keys[index] ?? row.sampleNumber}\u0000${row.testId}`;
      const current = known.get(key);
      if (current !== undefined && compareDecimals(current.value, row.value) === 0) {
        outcome.unchanged += 1;
        continue;
      }
      const audit = {
        actor: { type: "user", id: actor.id },
        target: { type: "simulation", id: simulationId },
        outcome: "success",
      } as const;
      if (current) {
        await trx
          .updateTable("correct_values")
          .set({ value: row.value, updated_by: actor.id, updated_at: now })
          .where("id", "=", current.id)
          .execute();
        current.value = row.value;
        await recordAudit(trx, {
          ...audit,
          action: "simulation_value_changed",
          metadata: { test_id: row.testId, correct_value_id: current.id },
        });
        outcome.changed += 1;
        continue;
      }
      const inserted = await trx
        .insertInto("correct_values")
        .values({
          simulation_id: simulationId,
          test_id: row.testId,
          sample_number: row.sampleNumber,
          value: row.value,
          created_by: actor.id,
          created_at: now,
          updated_by: actor.id,
          updated_at: now,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      known.set(key, { id: inserted.id, value: row.value });
      await recordAudit(trx, {
        ...audit,
        action: "simulation_value_set",
        metadata: { test_id: row.testId, correct_value_id: inserted.id },
      });
      outcome.added += 1;
    }
    return done(outcome);
  });
}

/** Removes one correct value of a simulation the actor teaches (`value_not_found` otherwise). */
export function removeCorrectValue(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string; correctValueId: string },
): Promise<SimulationResult> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const removed = await trx
      .deleteFrom("correct_values")
      .where("id", "=", input.correctValueId)
      .where("simulation_id", "=", simulationId)
      .returning(["id", "test_id"])
      .executeTakeFirst();
    if (!removed) {
      // NOTE: security review of #341 (B1); a value of another simulation is a probe, as a
      // foreign target lab of a move is (#300).
      logNotFound(actor.id, "correct_value", input.correctValueId);
      return refused("value_not_found");
    }
    await recordAudit(trx, {
      action: "simulation_value_removed",
      actor: { type: "user", id: actor.id },
      target: { type: "simulation", id: simulationId },
      outcome: "success",
      metadata: { test_id: removed.test_id, correct_value_id: removed.id },
    });
    return done(null);
  });
}

/**
 * Sets the accuracy limits of one test in a simulation the actor teaches (D13): one kind for
 * both, the yellow limit and the red limit. Logs `simulation_limits_set` with the test's id; an
 * unknown test (`test_not_found`) and a retired test the simulation does not use
 * (`test_retired`) are refused rows. No function removes limits, so a running simulation never
 * loses them.
 */
export function setLimits(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string; testId: string; kind: LimitKind; yellow: string; red: string },
  now: Date,
): Promise<SimulationResult> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const event = {
      action: "simulation_limits_set",
      actor: { type: "user", id: actor.id },
      target: { type: "simulation", id: simulationId },
    } as const;
    const refusal = await testRefusal(trx, simulationId, [input.testId]);
    if (refusal !== null) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: refusal });
      return refused(refusal);
    }
    const values = {
      kind: input.kind,
      yellow_limit: input.yellow,
      red_limit: input.red,
      updated_by: actor.id,
      updated_at: now,
    };
    await trx
      .insertInto("simulation_test_limits")
      .values({ simulation_id: simulationId, test_id: input.testId, ...values })
      .onConflict((oc) => oc.columns(["simulation_id", "test_id"]).doUpdateSet(values))
      .execute();
    await recordAudit(trx, { ...event, outcome: "success", metadata: { test_id: input.testId } });
    return done(null);
  });
}
