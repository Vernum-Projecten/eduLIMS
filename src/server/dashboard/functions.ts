// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The server functions of the teacher dashboard (D11, #386); bodies run on the server. Each
// requires the app role teacher first; the read checks the simulation's teacher row on the
// session user in SQL. They take no input: the dashboard is always the running simulation.
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import { readRunningSimulation } from "./running.ts";

/** Returns the running simulation when the teacher teaches it, or why the dashboard has none. */
export const getRunningSimulationFn = createServerFn({ method: "GET" })
  .middleware([requireRole("teacher")])
  .handler(({ context }) => readRunningSimulation(getDb(), context.user));
