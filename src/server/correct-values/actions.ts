// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Writing correct values and accuracy limits (D10, D13, #267). Every write runs under the
// simulation lock of `withSimulation`: the app role teacher, then a teacher row of the simulation
// for the session user, in SQL. A correct value changes in any state of the simulation, and every
// change leaves an activity-log row with ids only, never the value (B4, Q-SIM-1).
import "@tanstack/react-start/server-only";
import { type Kysely, sql, type Transaction } from "kysely";
import type { LimitKind } from "../../lib/correct-values.ts";
import type { SimulationId } from "../../lib/simulations.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  done,
  refused,
  type SimulationActor,
  type SimulationResult,
  withSimulation,
} from "../simulations/access.ts";
import type { CorrectValueRow } from "./schemas.ts";

/** How many rows of an entry were new, changed or already held that value. */
export interface SetCorrectValuesOutcome {
  added: number;
  changed: number;
  unchanged: number;
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
 * (D9), while the values a simulation already has for it stay changeable.
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
    .execute();
  if (tests.length !== testIds.length) return "test_not_found";
  if (tests.some((test) => test.retired_at !== null && !test.in_use)) return "test_retired";
  return null;
}

/**
 * Sets correct values in a simulation the actor teaches: a new sample number and test is added
 * (`simulation_value_set`), a known one takes the new value (`simulation_value_changed`), and an
 * unchanged value writes nothing. The sample number matches regardless of case. A lab plays no
 * part: every lab is judged against these values (D10).
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
      if (current?.value === row.value) {
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
    if (!removed) return refused("value_not_found");
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
 * both, the yellow limit and the red limit. Logs `simulation_limits_set` with the test's id.
 */
export function setLimits(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: { simulationId: string; testId: string; kind: LimitKind; yellow: string; red: string },
  now: Date,
): Promise<SimulationResult> {
  return withSimulation(db, actor, input.simulationId, async (trx, simulationId) => {
    const test = await trx
      .selectFrom("catalogue_tests")
      .select("id")
      .where("id", "=", input.testId)
      .executeTakeFirst();
    if (!test) return refused("test_not_found");
    const values = {
      kind: input.kind,
      yellow_limit: input.yellow,
      red_limit: input.red,
      updated_by: actor.id,
      updated_at: now,
    };
    await trx
      .insertInto("simulation_test_limits")
      .values({ simulation_id: simulationId, test_id: test.id, ...values })
      .onConflict((oc) => oc.columns(["simulation_id", "test_id"]).doUpdateSet(values))
      .execute();
    await recordAudit(trx, {
      action: "simulation_limits_set",
      actor: { type: "user", id: actor.id },
      target: { type: "simulation", id: simulationId },
      outcome: "success",
      metadata: { test_id: test.id },
    });
    return done(null);
  });
}
