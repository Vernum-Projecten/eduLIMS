// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Whether a simulation uses a test of the catalogue (D9, #266). A test in use keeps its unit and
// its source, and can be retired but not deleted.
import "@tanstack/react-start/server-only";
import type { Kysely } from "kysely";
import type { CatalogueTestId } from "../../lib/catalogue.ts";
import type { DB } from "../db/schema.gen.ts";

/**
 * Returns the tests of `ids` that a simulation uses: a correct value (D10) or a requested test
 * (S12) that names it. Runs inside the caller's transaction when given one.
 */
export async function testsInUse(
  _db: Kysely<DB>,
  _ids: readonly CatalogueTestId[],
): Promise<ReadonlySet<CatalogueTestId>> {
  // NOTE: #266; no table refers to a test yet, so no test is in use. #267 (correct values) and
  // #268 (requests) add their tables and make this query them, in the same transaction.
  // TODO(#267): count a test with a correct value in any simulation as in use.
  // TODO(#268): count a test a request names as in use.
  return new Set();
}

/** Returns whether a simulation uses the test `id`; see {@link testsInUse}. */
export async function isTestInUse(db: Kysely<DB>, id: CatalogueTestId): Promise<boolean> {
  return (await testsInUse(db, [id])).has(id);
}
