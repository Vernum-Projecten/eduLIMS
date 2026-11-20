// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of the test catalogue (D9, S4, #266); bodies run on the server. An
// administrator manages the catalogue (owner, 2026-11-20, #393): every function requires the app
// role admin first, then parses its input with Zod. Teachers see the active tests only as the
// options of a simulation's correct values (src/server/correct-values/). No student function
// exists here.
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import { createTest, restoreTest, retireTest, updateTest } from "./actions.ts";
import { readTestPage } from "./reads.ts";
import { createTestInput, listTestsInput, testIdInput, updateTestInput } from "./schemas.ts";

const admin = requireRole("admin");

/** Returns one page of the catalogue, the count of every status and source, and its materials. */
export const listCatalogueTests = createServerFn({ method: "GET" })
  .middleware([admin])
  .validator(listTestsInput)
  .handler(({ data, context }) => readTestPage({ db: getDb(), actor: context.user }, data));

/** Adds a test to the catalogue (D9). */
export const createCatalogueTest = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(createTestInput)
  .handler(({ data, context }) =>
    createTest({ db: getDb(), actor: context.user, now: new Date() }, data),
  );

/** Changes an active test; a test in use keeps its unit and source (D9). */
export const updateCatalogueTest = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(updateTestInput)
  .handler(({ data, context }) =>
    updateTest({ db: getDb(), actor: context.user, now: new Date() }, data),
  );

/** Retires a test, so new simulations do not offer it. */
export const retireCatalogueTest = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(testIdInput)
  .handler(({ data, context }) =>
    retireTest({ db: getDb(), actor: context.user, now: new Date() }, data),
  );

/** Restores a retired test to the catalogue. */
export const restoreCatalogueTest = createServerFn({ method: "POST" })
  .middleware([admin])
  .validator(testIdInput)
  .handler(({ data, context }) =>
    restoreTest({ db: getDb(), actor: context.user, now: new Date() }, data),
  );
