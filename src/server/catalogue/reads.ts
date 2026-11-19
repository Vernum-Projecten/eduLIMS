// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The guarded read of the test catalogue (D9, #266). The server function checks the teacher role
// in its middleware first; this checks it again, so the read is safe on its own. Students read
// the catalogue only through the screens of later issues, with names, units and materials only.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertTeacher } from "../simulations/access.ts";
import { testUsage } from "./in-use.ts";
import {
  type CatalogueTestFacets,
  type CatalogueTestPage,
  listTests,
  testFacets,
} from "./queries.ts";
import type { ListTestsInput } from "./schemas.ts";

/** What a read runs with: the database and the caller. */
export interface TestReadContext {
  db: Kysely<DB>;
  actor: Pick<SessionUser, "roles">;
}

/** One page of the catalogue with the count of every facet value. */
export type CatalogueRegisterPage = CatalogueTestPage & { facets: CatalogueTestFacets };

/**
 * Returns one page of the catalogue and its facet counts.
 *
 * @throws AuthError 403 without the app role teacher.
 */
export async function readTestPage(
  ctx: TestReadContext,
  input: ListTestsInput,
): Promise<CatalogueRegisterPage> {
  assertTeacher(ctx.actor);
  const [page, facets] = await Promise.all([
    listTests(ctx.db, input, (ids) => testUsage(ctx.db, ids)),
    testFacets(ctx.db, input),
  ]);
  return { ...page, facets };
}
