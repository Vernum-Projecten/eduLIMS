// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Server functions of the integration status (B3, #35); bodies run on the server. Both require
// the admin role first. Neither takes a target: the input schema is an empty strict object, so
// a request that names a URL, host or path is refused before the handler runs (ASVS V1.3.6).
import { createServerFn } from "@tanstack/react-start";
import { getDb } from "../db/index.ts";
import { getEnv } from "../env.ts";
import { requireRole } from "../middleware.ts";
import { checkNow, readStatus } from "./checks.ts";
import { defaultProbeDeps } from "./probe.ts";
import { integrationStatusInput } from "./schemas.ts";

/** Returns the latest check of every integration. */
export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireRole("admin")])
  .validator(integrationStatusInput)
  .handler(({ context }) => readStatus({ db: getDb(), actor: context.user }, new Date()));

/** Checks every configured integration now and returns the new status. */
export const checkIntegrationsNow = createServerFn({ method: "POST" })
  .middleware([requireRole("admin")])
  .validator(integrationStatusInput)
  .handler(({ context }) =>
    checkNow({ db: getDb(), env: getEnv(), deps: defaultProbeDeps(), actor: context.user }),
  );
