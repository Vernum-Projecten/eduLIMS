// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of a team's tolerances (S13, #269); bodies run on the server. Each requires
// its app role first, then parses its input with Zod; the service checks the lab membership or
// the simulation's teacher row on the session user in SQL (S10, D11). No function here selects a
// correct value or an accuracy limit (Q-SIM-1).
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import { setTolerance } from "./actions.ts";
import { readStudentTolerances, readTeacherTolerances } from "./queries.ts";
import { labTolerancesInput, setToleranceInput } from "./schemas.ts";

const teacher = requireRole("teacher");
const student = requireRole("student");

/** Returns the tolerance page of the student's own lab; `notFound` for any other lab. */
export const getMyTolerancesFn = createServerFn({ method: "GET" })
  .middleware([student])
  .validator(labTolerancesInput)
  .handler(async ({ data, context }) => {
    const page = await readStudentTolerances(getDb(), context.user, data.labId);
    if (!page) throw notFound();
    return page;
  });

/** Sets the tolerance of one test in the student's own lab (S13). */
export const setToleranceFn = createServerFn({ method: "POST" })
  .middleware([student])
  .validator(setToleranceInput)
  .handler(({ data, context }) => setTolerance(getDb(), context.user, data));

/** Returns every tolerance of a lab the teacher teaches, with its changes; `notFound` otherwise. */
export const getLabTolerancesFn = createServerFn({ method: "GET" })
  .middleware([teacher])
  .validator(labTolerancesInput)
  .handler(async ({ data, context }) => {
    const changes = await readTeacherTolerances(getDb(), context.user, data.labId);
    if (!changes) throw notFound();
    return changes;
  });
