// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The guarded reads of the analyser register (B3, #35). The server functions check the admin
// role in their middleware first; these check it again, so each read is safe on its own.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { SessionUser } from "../authz.ts";
import type { DB } from "../db/schema.gen.ts";
import { assertAdmin } from "../users/actions.ts";
import {
  type AnalyserFacets,
  type AnalyserPage,
  analyserFacets,
  listAnalysers,
} from "./queries.ts";
import type { ListAnalysersInput } from "./schemas.ts";

/** What a read runs with: the database and the caller. */
export interface AnalyserReadContext {
  db: Kysely<DB>;
  actor: Pick<SessionUser, "roles">;
}

/** One page of the register with the count of every facet value. */
export type AnalyserRegisterPage = AnalyserPage & { facets: AnalyserFacets };

/**
 * Returns one page of the register and its facet counts.
 *
 * @throws AuthError 403 without the admin role.
 */
export async function readAnalyserPage(
  ctx: AnalyserReadContext,
  input: ListAnalysersInput,
): Promise<AnalyserRegisterPage> {
  assertAdmin(ctx.actor);
  const [page, facets] = await Promise.all([
    listAnalysers(ctx.db, input),
    analyserFacets(ctx.db, input),
  ]);
  return { ...page, facets };
}
