// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of correct values and accuracy limits (D10, D13, #267); bodies run on the
// server. Every one requires the app role teacher first, then parses its input with Zod; the
// service checks the teacher row of the simulation on the session user in SQL (D11, R-13). No
// function here is open to a student (Q-SIM-1).
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import { removeCorrectValue, setCorrectValues, setLimits } from "./actions.ts";
import { getCorrectValuesPage } from "./queries.ts";
import {
  correctValueIdInput,
  correctValuesPageInput,
  setCorrectValuesInput,
  setLimitsInput,
} from "./schemas.ts";

const teacher = requireRole("teacher");

/** Returns the correct values and limits of a simulation; `notFound` unless the teacher teaches it. */
export const getCorrectValuesFn = createServerFn({ method: "GET" })
  .middleware([teacher])
  .validator(correctValuesPageInput)
  .handler(async ({ data, context }) => {
    const page = await getCorrectValuesPage(getDb(), context.user, data.simulationId);
    if (!page) throw notFound();
    return page;
  });

/** Adds or changes correct values of a simulation (D10). */
export const setCorrectValuesFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(setCorrectValuesInput)
  .handler(({ data, context }) => setCorrectValues(getDb(), context.user, data, new Date()));

/** Removes one correct value of a simulation. */
export const removeCorrectValueFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(correctValueIdInput)
  .handler(({ data, context }) => removeCorrectValue(getDb(), context.user, data));

/** Sets the accuracy limits of one test in a simulation (D13). */
export const setLimitsFn = createServerFn({ method: "POST" })
  .middleware([teacher])
  .validator(setLimitsInput)
  .handler(({ data, context }) => setLimits(getDb(), context.user, data, new Date()));
