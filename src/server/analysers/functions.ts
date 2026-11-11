// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of the analyser register (B3, #35); bodies run on the server. Every one
// requires the admin role first (a teacher-admin holds it), then parses its input with Zod.
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import { createAnalyser, retireAnalyser, updateAnalyser } from "./actions.ts";
import { readAnalyserPage } from "./reads.ts";
import {
  analyserIdInput,
  createAnalyserInput,
  listAnalysersInput,
  updateAnalyserInput,
} from "./schemas.ts";

/** Returns one page of the register and the count of every status and route. */
export const listAdminAnalysers = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(listAnalysersInput)
  .handler(({ data, context }) => readAnalyserPage({ db: getDb(), actor: context.user }, data));

/** Adds an analyser to the register. */
export const createAdminAnalyser = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(createAnalyserInput)
  .handler(({ data, context }) =>
    createAnalyser({ db: getDb(), actor: context.user, now: new Date() }, data),
  );

/** Changes an analyser that is not retired. */
export const updateAdminAnalyser = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(updateAnalyserInput)
  .handler(({ data, context }) =>
    updateAnalyser({ db: getDb(), actor: context.user, now: new Date() }, data),
  );

/** Retires an analyser; the row stays for the traceability of its results. */
export const retireAdminAnalyser = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(analyserIdInput)
  .handler(({ data, context }) =>
    retireAnalyser({ db: getDb(), actor: context.user, now: new Date() }, data),
  );
