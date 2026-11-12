// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The server function of the Admin portal's overview (#36); its body runs on the server. It
// requires the admin role first; the read checks it again.
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { requireRole } from "../middleware.ts";
import { readAdminOverview } from "./queries.ts";
import { adminOverviewInput } from "./schemas.ts";

/** Returns the overview's account counts and its latest activity-log events. */
export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(adminOverviewInput)
  .handler(({ context }) => readAdminOverview({ db: getDb(), actor: context.user }, new Date()));
