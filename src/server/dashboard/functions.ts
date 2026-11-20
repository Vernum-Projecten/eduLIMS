// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The server function of the teacher dashboard (D11, #271); its body runs on the server. It
// requires the app role teacher first; the read checks the simulation's teacher row on the
// session user in SQL. It takes no input: the board is always the running simulation (#386).
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import { readTeacherDashboard } from "./queries.ts";

/** Returns the board of the running simulation when the teacher teaches it (D11). */
export const getTeacherDashboardFn = createServerFn({ method: "GET" })
  .middleware([requireRole("teacher")])
  .handler(({ context }) => readTeacherDashboard(getDb(), context.user, new Date()));
