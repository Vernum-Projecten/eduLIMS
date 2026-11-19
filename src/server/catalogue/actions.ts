// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The changes to the test catalogue (D9, S4, #266): create, edit, retire and restore. Each runs
// in one transaction with its activity-log row (B4), which carries ids and the names of the
// changed settings, never a value. The catalogue is shared: every teacher changes every test.
import "@tanstack/react-start/server-only";
import type { Kysely, Transaction } from "kysely";
import {
  type CatalogueTestId,
  parseCatalogueTestId,
  sameSource,
  type TestSource,
} from "../../lib/catalogue.ts";
import { recordAudit } from "../audit/record.ts";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertTeacher } from "../simulations/access.ts";
import { isTestInUse } from "./in-use.ts";
import { STORED_TEST_COLUMNS, type StoredTest, storedSource } from "./queries.ts";
import type { TestDefinition } from "./schemas.ts";

/** Why a change was refused or failed; the screen maps each code to a translated message. */
export const TEST_ACTION_ERRORS = [
  "not_found",
  "name_taken",
  "retired",
  "not_retired",
  "in_use",
] as const;
export type TestActionError = (typeof TEST_ACTION_ERRORS)[number];

/** The outcome of a change: done with the test's id, or refused with a code. */
export type TestActionResult =
  | { ok: true; testId: CatalogueTestId }
  | { ok: false; error: TestActionError };

/** What every change runs with: the database, the teacher and the server's time (Q-SIM-2). */
export interface TestActionContext {
  db: Kysely<DB>;
  actor: Pick<SessionUser, "id" | "roles">;
  now: Date;
}

const NAME_CONSTRAINT = "catalogue_tests_active_name_key";

/** A refusal raised inside a transaction, so the transaction rolls back before it is returned. */
class Refusal extends Error {
  readonly code: TestActionError;
  constructor(code: TestActionError) {
    super(code);
    this.code = code;
  }
}

/** Returns whether `error` is PostgreSQL's unique violation of an active test's name. */
export function isNameTaken(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (
    Reflect.get(error, "code") === "23505" && Reflect.get(error, "constraint") === NAME_CONSTRAINT
  );
}

/** Maps what a transaction threw to a result; anything unknown is rethrown (fail loud). */
function refusalOf(error: unknown): TestActionResult {
  if (error instanceof Refusal) return { ok: false, error: error.code };
  if (isNameTaken(error)) return { ok: false, error: "name_taken" };
  throw error;
}

function sourceColumns(source: TestSource) {
  switch (source.kind) {
    case "afinion":
      return { source: source.kind, afinion_analyte: source.analyte, epoch_calculated_by: null };
    case "epoch_upload":
      return {
        source: source.kind,
        afinion_analyte: null,
        epoch_calculated_by: source.calculatedBy,
      };
    case "manual":
      return { source: source.kind, afinion_analyte: null, epoch_calculated_by: null };
    default: {
      const unknown: never = source;
      return unknown;
    }
  }
}

function columnsOf(test: TestDefinition) {
  return {
    name: test.name,
    unit: test.unit,
    material: test.material,
    ...sourceColumns(test.source),
  };
}

/**
 * Refuses a name another active test holds, compared case-insensitively in SQL. The partial
 * unique index holds the same rule for two transactions that pass this check at once.
 */
async function assertNameFree(
  trx: Transaction<DB>,
  name: string,
  except: CatalogueTestId | null,
): Promise<void> {
  let query = trx
    .selectFrom("catalogue_tests")
    .select("id")
    .where((eb) => eb(eb.fn("lower", ["name"]), "=", eb.fn("lower", [eb.val(name)])))
    .where("retired_at", "is", null);
  if (except !== null) query = query.where("id", "<>", except);
  if (await query.executeTakeFirst()) throw new Refusal("name_taken");
}

/** Locks one test (`FOR UPDATE`) and returns it, or refuses with `not_found`. */
async function lockTest(trx: Transaction<DB>, testId: string): Promise<StoredTest> {
  const id = parseCatalogueTestId(testId);
  if (id === null) throw new Refusal("not_found");
  const row = await trx
    .selectFrom("catalogue_tests")
    .select(STORED_TEST_COLUMNS)
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw new Refusal("not_found");
  return row;
}

/** The names of the settings an edit changes, for the log: names only, never values (B4). */
function changedFields(before: StoredTest, after: TestDefinition): string[] {
  const next = columnsOf(after);
  const fields: string[] = [];
  if (before.name !== next.name) fields.push("name");
  if (before.unit !== next.unit) fields.push("unit");
  if (before.material !== next.material) fields.push("material");
  if (before.source !== next.source) fields.push("source");
  if (before.afinion_analyte !== next.afinion_analyte) fields.push("analyte");
  if (before.epoch_calculated_by !== next.epoch_calculated_by) fields.push("calculated_by");
  return fields;
}

/**
 * Adds a test to the catalogue and logs `test_created`.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function createTest(
  ctx: TestActionContext,
  input: TestDefinition,
): Promise<TestActionResult> {
  assertTeacher(ctx.actor);
  try {
    return await ctx.db.transaction().execute(async (trx) => {
      await assertNameFree(trx, input.name, null);
      const row = await trx
        .insertInto("catalogue_tests")
        .values({
          ...columnsOf(input),
          created_by: ctx.actor.id,
          created_at: ctx.now,
          updated_at: ctx.now,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const testId = parseCatalogueTestId(row.id);
      if (testId === null) throw new Error("catalogue_tests.id is not a UUID");
      await recordAudit(trx, {
        action: "test_created",
        actor: { type: "user", id: ctx.actor.id },
        outcome: "success",
        target: { type: "test", id: testId },
      });
      return { ok: true, testId };
    });
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Changes an active test and logs `test_changed` with the names of the changed settings. A test
 * a simulation uses keeps its unit and its source (D9); switching who calculates an Epoch 2
 * concentration stays allowed.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function updateTest(
  ctx: TestActionContext,
  input: { testId: string; test: TestDefinition },
): Promise<TestActionResult> {
  assertTeacher(ctx.actor);
  try {
    return await ctx.db.transaction().execute(async (trx) => {
      const current = await lockTest(trx, input.testId);
      const testId = parseCatalogueTestId(current.id);
      if (testId === null) throw new Refusal("not_found");
      if (current.retired_at !== null) throw new Refusal("retired");
      const fixedChanged =
        current.unit !== input.test.unit || !sameSource(storedSource(current), input.test.source);
      if (fixedChanged && (await isTestInUse(trx, testId))) throw new Refusal("in_use");
      await assertNameFree(trx, input.test.name, testId);
      const fields = changedFields(current, input.test);
      if (fields.length === 0) return { ok: true, testId };
      await trx
        .updateTable("catalogue_tests")
        .set({ ...columnsOf(input.test), updated_at: ctx.now })
        .where("id", "=", testId)
        .execute();
      await recordAudit(trx, {
        action: "test_changed",
        actor: { type: "user", id: ctx.actor.id },
        outcome: "success",
        target: { type: "test", id: testId },
        metadata: { fields },
      });
      return { ok: true, testId };
    });
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Retires a test, so new simulations do not offer it, and logs `test_retired`. The row stays for
 * the simulations that use it.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function retireTest(
  ctx: TestActionContext,
  input: { testId: string },
): Promise<TestActionResult> {
  assertTeacher(ctx.actor);
  try {
    return await ctx.db.transaction().execute(async (trx) => {
      const current = await lockTest(trx, input.testId);
      const testId = parseCatalogueTestId(current.id);
      if (testId === null) throw new Refusal("not_found");
      if (current.retired_at !== null) throw new Refusal("retired");
      await trx
        .updateTable("catalogue_tests")
        .set({ retired_at: ctx.now, updated_at: ctx.now })
        .where("id", "=", testId)
        .execute();
      await recordAudit(trx, {
        action: "test_retired",
        actor: { type: "user", id: ctx.actor.id },
        outcome: "success",
        target: { type: "test", id: testId },
      });
      return { ok: true, testId };
    });
  } catch (error) {
    return refusalOf(error);
  }
}

/**
 * Restores a retired test, unless an active test holds its name now, and logs `test_restored`.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function restoreTest(
  ctx: TestActionContext,
  input: { testId: string },
): Promise<TestActionResult> {
  assertTeacher(ctx.actor);
  try {
    return await ctx.db.transaction().execute(async (trx) => {
      const current = await lockTest(trx, input.testId);
      const testId = parseCatalogueTestId(current.id);
      if (testId === null) throw new Refusal("not_found");
      if (current.retired_at === null) throw new Refusal("not_retired");
      await assertNameFree(trx, current.name, testId);
      await trx
        .updateTable("catalogue_tests")
        .set({ retired_at: null, updated_at: ctx.now })
        .where("id", "=", testId)
        .execute();
      await recordAudit(trx, {
        action: "test_restored",
        actor: { type: "user", id: ctx.actor.id },
        outcome: "success",
        target: { type: "test", id: testId },
      });
      return { ok: true, testId };
    });
  } catch (error) {
    return refusalOf(error);
  }
}
