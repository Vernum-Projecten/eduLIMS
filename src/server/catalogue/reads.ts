// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The guarded read of the test catalogue (D9; owner 2026-11-20 on #393): an administrator reads
// the whole catalogue to manage it. The server function checks the role in its middleware first;
// this checks it again, so the read is safe on its own.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertCatalogueAdmin } from "./access.ts";
import { testUsage } from "./in-use.ts";
import {
  type CatalogueTestFacets,
  type CatalogueTestPage,
  listMaterials,
  listTests,
  testFacets,
} from "./queries.ts";
import type { ListTestsInput } from "./schemas.ts";

/** What a read runs with: the database and the caller. */
export interface TestReadContext {
  db: Kysely<DB>;
  actor: Pick<SessionUser, "roles">;
}

/** One page of the catalogue with the count of every facet value and the materials in use. */
export type CatalogueRegisterPage = CatalogueTestPage & {
  facets: CatalogueTestFacets;
  /** The materials the catalogue uses, the form's suggestions (#393). */
  materials: string[];
};

/**
 * Returns one page of the catalogue, its facet counts and the materials in use.
 *
 * @throws AuthError 403 without the app role admin.
 */
export async function readTestPage(
  ctx: TestReadContext,
  input: ListTestsInput,
): Promise<CatalogueRegisterPage> {
  assertCatalogueAdmin(ctx.actor);
  const [page, facets, materials] = await Promise.all([
    listTests(ctx.db, input, (ids) => testUsage(ctx.db, ids)),
    testFacets(ctx.db, input),
    listMaterials(ctx.db),
  ]);
  return { ...page, facets, materials };
}
