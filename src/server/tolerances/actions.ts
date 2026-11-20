// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Setting a team's tolerance (S13, #269). A member of the lab sets it while the simulation runs;
// every change is a new row and leaves an activity-log row with ids only, never a limit (B4).
// A tolerance is never removed, so a test that had one keeps one (S15).
import "@tanstack/react-start/server-only";
import { type Kysely, sql, type Transaction } from "kysely";
import { parseLabId } from "../../lib/simulations.ts";
import { sameTolerance } from "../../lib/tolerance.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";
import {
  done,
  logNotFound,
  refused,
  type SimulationActor,
  type SimulationResult,
} from "../simulations/access.ts";
import { findStudentLab, findWorkingStudentLab } from "../simulations/student-access.ts";
import { assertStudent } from "./queries.ts";
import type { SetToleranceInput } from "./schemas.ts";

/** What a set did: whether it stored a new tolerance, or the lab already had these limits. */
export interface SetToleranceOutcome {
  changed: boolean;
}

/**
 * Refuses a test that is not in the catalogue (`test_not_found`), and a retired test the lab
 * has no tolerance for yet (`test_retired`, D9). The test is read `FOR SHARE`, which waits for a
 * retirement in progress (`retireTest` takes it `FOR UPDATE`).
 */
async function testRefusal(
  trx: Transaction<DB>,
  labId: string,
  testId: string,
): Promise<"test_not_found" | "test_retired" | null> {
  const test = await trx
    .selectFrom("catalogue_tests")
    .select((eb) => [
      "catalogue_tests.retired_at",
      eb
        .exists(
          eb
            .selectFrom("lab_tolerances")
            .select("lab_tolerances.id")
            .whereRef("lab_tolerances.test_id", "=", "catalogue_tests.id")
            .where("lab_tolerances.lab_id", "=", labId),
        )
        .as("in_use"),
    ])
    .where("catalogue_tests.id", "=", testId)
    .forShare("catalogue_tests")
    .executeTakeFirst();
  if (!test) return "test_not_found";
  if (test.retired_at !== null && !test.in_use) return "test_retired";
  return null;
}

/**
 * Sets the tolerance of one test in the actor's own lab (S13): a new row when the limits differ
 * from the current ones, compared as decimals, and nothing when they are the same. Refused with
 * `not_found` (logged) when the actor is no member of the lab, `not_running` when the lab's
 * simulation does not run, and `test_not_found` or `test_retired` for the test.
 *
 * @throws AuthError 403 without the app role student.
 */
export async function setTolerance(
  db: Kysely<DB>,
  actor: SimulationActor,
  input: SetToleranceInput,
): Promise<SimulationResult<SetToleranceOutcome>> {
  assertStudent(actor);
  if (parseLabId(input.labId) === null) {
    logNotFound(actor.id, "lab", input.labId);
    return refused("not_found");
  }
  return db.transaction().execute(async (trx) => {
    const lab = await findWorkingStudentLab(trx, actor.id, input.labId);
    const event = {
      action: "lab_tolerance_set",
      actor: { type: "user", id: actor.id },
      target: { type: "lab", id: input.labId },
    } as const;
    if (lab === null) {
      if ((await findStudentLab(trx, actor.id, input.labId)) === null) {
        logNotFound(actor.id, "lab", input.labId);
        return refused<SetToleranceOutcome>("not_found");
      }
      await recordAudit(trx, { ...event, outcome: "refused", reason: "not_running" });
      return refused<SetToleranceOutcome>("not_running");
    }
    // NOTE: no requirement governs this: our own design; members of one lab set its tolerances
    // one at a time, so the newest row is the last one written.
    await trx
      .selectFrom("labs")
      .select("id")
      .where("id", "=", lab.labId)
      .forNoKeyUpdate()
      .executeTakeFirst();
    const refusal = await testRefusal(trx, lab.labId, input.testId);
    if (refusal !== null) {
      await recordAudit(trx, { ...event, outcome: "refused", reason: refusal });
      return refused<SetToleranceOutcome>(refusal);
    }
    const current = await trx
      .selectFrom("lab_tolerances")
      .select([
        sql<string>`lower_limit::text`.as("lower"),
        sql<string>`upper_limit::text`.as("upper"),
      ])
      .where("lab_id", "=", lab.labId)
      .where("test_id", "=", input.testId)
      .orderBy("set_at", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();
    if (current && sameTolerance(current, input)) return done({ changed: false });
    const inserted = await trx
      .insertInto("lab_tolerances")
      .values({
        simulation_id: lab.simulationId,
        lab_id: lab.labId,
        test_id: input.testId,
        lower_limit: input.lower,
        upper_limit: input.upper,
        set_by: actor.id,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      ...event,
      outcome: "success",
      metadata: { test_id: input.testId, tolerance_id: inserted.id },
    });
    return done({ changed: true });
  });
}
