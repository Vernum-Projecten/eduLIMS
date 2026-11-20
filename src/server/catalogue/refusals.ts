// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The refusals of the test catalogue's changes (D9, #266): the codes, the error a transaction
// throws to roll back, and the activity-log row of a refused change (ASVS V16.3.3), written after
// the rollback in a statement of its own, with ids and the code only.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import { type CatalogueTestId, parseCatalogueTestId } from "../../lib/catalogue.ts";
import { recordAudit } from "../audit/record.ts";
import type { DB } from "../db/schema.gen.ts";

/** Why a change was refused or failed; the screen maps each code to a translated message. */
export const TEST_ACTION_ERRORS = [
  "not_found",
  "name_taken",
  "retired",
  "not_retired",
  "in_use",
  "in_running_simulation",
  "analyte_taken",
  "unit_unsupported",
  "unit_fixed_by_analyte",
] as const;
export type TestActionError = (typeof TEST_ACTION_ERRORS)[number];

/** The outcome of a change: done with the test's id, or refused with a code. */
export type TestActionResult =
  | { ok: true; testId: CatalogueTestId }
  | { ok: false; error: TestActionError };

/** The activity-log action of each change, for its refused row. */
export type TestAuditAction = "test_created" | "test_changed" | "test_retired" | "test_restored";

const NAME_CONSTRAINT = "catalogue_tests_active_name_key";
const ANALYTE_CONSTRAINT = "catalogue_tests_active_analyte_key";

/** A refusal raised inside a transaction, so the transaction rolls back before it is returned. */
export class Refusal extends Error {
  readonly code: TestActionError;
  constructor(code: TestActionError) {
    super(code);
    this.code = code;
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  return Reflect.get(error, "code") === "23505" && Reflect.get(error, "constraint") === constraint;
}

/** Returns whether `error` is PostgreSQL's unique violation of an active test's name. */
export function isNameTaken(error: unknown): boolean {
  return isUniqueViolation(error, NAME_CONSTRAINT);
}

/** Returns whether `error` is PostgreSQL's unique violation of an active Afinion 2 analyte. */
export function isAnalyteTaken(error: unknown): boolean {
  return isUniqueViolation(error, ANALYTE_CONSTRAINT);
}

/** Maps what a transaction threw to a refusal code; anything unknown is rethrown (fail loud). */
function refusalCodeOf(error: unknown): TestActionError {
  if (error instanceof Refusal) return error.code;
  if (isNameTaken(error)) return "name_taken";
  if (isAnalyteTaken(error)) return "analyte_taken";
  throw error;
}

/** Who was refused, at what, and about which test. */
export interface RefusedChange {
  db: Kysely<DB>;
  actorId: string;
  action: TestAuditAction;
  /** The test the change named; absent for a create, or when the id is not a test id. */
  testId?: string;
}

/**
 * Turns what a change's transaction threw into its refusal, and writes the refused row of the
 * activity log after the rollback: the action, the actor, the test's id when it is one, and the
 * code as the reason, never a value the teacher typed. Anything but a refusal is rethrown.
 */
export async function refusedChange(
  change: RefusedChange,
  error: unknown,
): Promise<TestActionResult> {
  const code = refusalCodeOf(error);
  const testId = change.testId === undefined ? null : parseCatalogueTestId(change.testId);
  await recordAudit(change.db, {
    action: change.action,
    actor: { type: "user", id: change.actorId },
    outcome: "refused",
    reason: code,
    ...(testId === null ? {} : { target: { type: "test", id: testId } }),
  });
  return { ok: false, error: code };
}
