// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of the activity log screen (#36, B4); bodies run on the server. Each one
// requires the admin role first, then parses its input with Zod.
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import { readActivityLog, searchActivityUsers } from "./queries.ts";
import { activityUserSearchInput, listActivityInput } from "./schemas.ts";

/** Returns one page of the activity log with its facet counts and the names it shows. */
export const listAdminActivity = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(listActivityInput)
  .handler(async ({ data, context }) => readActivityLog(getDb(), context.user, data));

/** Returns the users whose name or e-mail address matches, for the actor and target filters. */
export const searchAdminActivityUsers = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(activityUserSearchInput)
  .handler(async ({ data, context }) => searchActivityUsers(getDb(), context.user, data));
