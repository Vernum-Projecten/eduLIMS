// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Shared set-up of the catalogue service's database tests: invented tests, invented
// @example.test administrators, and the reads the tests assert on. Test support only.
import type { Kysely } from "kysely";
import type { CatalogueTestId } from "../../lib/catalogue.ts";
import type { Role } from "../../lib/roles.ts";
import type { DB } from "../db/schema.gen.ts";
import { createTestDb } from "../db/test-db.ts";
import { person } from "../simulations/test-helpers.ts";
import { createTest, type TestActionContext } from "./actions.ts";
import type { TestDefinition } from "./schemas.ts";

export const NOW = new Date("2026-11-19T09:00:00Z");
export const LATER = new Date("2026-11-19T10:00:00Z");
export const UNKNOWN = "01900000-0000-7000-8000-000000000000";

/** An invented Afinion 2 test. */
export const CRP: TestDefinition = {
  name: "CRP",
  unit: "mg/L",
  material: "blood",
  source: { kind: "afinion", analyte: "CRP" },
};

/** An invented Epoch 2 test the lab calculates. */
export const GLUCOSE: TestDefinition = {
  name: "Glucose",
  unit: "mmol/L",
  material: "plasma",
  source: { kind: "epoch_upload", calculatedBy: "team" },
};

/** One test's database, opened on first use and rolled back by `destroy`. */
export function catalogueTestDb() {
  let db: Kysely<DB> | undefined;
  return {
    /** Returns a context for a caller with `roles`, a user row unless the set is empty. */
    async admin(key = "admin", roles: readonly Role[] = ["admin"], now = NOW) {
      db ??= await createTestDb();
      // The user table refuses an empty role set, so a caller without a role is a session user.
      const actor = roles.length === 0 ? { id: key, roles } : await person(db, key, roles);
      return { db, actor, now } satisfies TestActionContext;
    },
    async database(): Promise<Kysely<DB>> {
      db ??= await createTestDb();
      return db;
    },
    async destroy(): Promise<void> {
      await db?.destroy();
      db = undefined;
    },
  };
}

/**
 * Returns `actor` with the admin role added, a teacher-admin, who may change the catalogue
 * (#393); the user row keeps its own roles, which the service never reads.
 */
export function asAdmin<T extends { roles: readonly Role[] }>(actor: T): T {
  return { ...actor, roles: [...actor.roles.filter((role) => role !== "admin"), "admin"] };
}

/** The activity-log rows of the catalogue, oldest first. */
export function events(database: Kysely<DB>) {
  return database
    .selectFrom("audit_event")
    .select([
      "action",
      "actor_type",
      "actor_id",
      "target_type",
      "target_id",
      "outcome",
      "reason_code",
      "metadata",
    ])
    .where("action", "like", "test_%")
    .orderBy("occurred_at")
    .orderBy("id")
    .execute();
}

/** The stored columns of one test. */
export function stored(database: Kysely<DB>, id: string) {
  return database
    .selectFrom("catalogue_tests")
    .select([
      "name",
      "unit",
      "material",
      "source",
      "afinion_analyte",
      "epoch_calculated_by",
      "created_by",
      "updated_at",
      "retired_at",
    ])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

/** Creates `input` and returns its id, failing the test on a refusal. */
export async function created(ctx: TestActionContext, input = CRP): Promise<CatalogueTestId> {
  const result = await createTest(ctx, input);
  if (!result.ok) throw new Error(`create refused: ${result.error}`);
  return result.testId;
}
